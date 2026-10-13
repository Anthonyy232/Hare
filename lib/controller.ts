import { SPEED, CONTROLLER, UI, OBSERVER } from './constants';
import type { Settings, SiteHandler, KeyAction } from './types';
import type { HitmapButton } from './cross-frame-pointer';
import controllerCSS from '../assets/controller.css?raw';
import { logger } from './logger';
import { safeMedia } from './safe-media';
import { createIcon, type ICONS } from './controller-icons';

let sharedStyleSheet: CSSStyleSheet | null = null;

function getStyleSheet(): CSSStyleSheet {
  if (!sharedStyleSheet) {
    sharedStyleSheet = new CSSStyleSheet();
    sharedStyleSheet.replaceSync(controllerCSS);
  }
  return sharedStyleSheet;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const formatSpeed = (speed: number) => `${speed.toFixed(2)}x`;

let controllerIdCounter = 0;
const positionedParents = new WeakMap<HTMLElement, { count: number; value: string; priority: string }>();
const SPEED_BLOCKED = 'Speed control blocked';
const POSITION_CHECK_INTERVAL_MS = 2000;
const ENFORCEMENT_DEBOUNCE_MS = 500;

type ControllerPosition = { target: Element; method: 'prepend' | 'append' };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

const BUTTONS: ReadonlyArray<[icon: keyof typeof ICONS, action: KeyAction, label: string]> = [
  ['rewind', 'rewind', 'Rewind'],
  ['slower', 'slower', 'Slower'],
  ['faster', 'faster', 'Faster'],
  ['advance', 'advance', 'Advance'],
  ['hide', 'display', 'Hide controller'],
];

export class VideoController {
  readonly id = `hare-${++controllerIdCounter}`;

  private readonly wrapper = document.createElement(CONTROLLER.ELEMENT_TAG);
  private readonly controllerEl = document.createElement('div');
  private readonly speedDisplay = document.createElement('span');
  private readonly osdEl = document.createElement('div');
  private readonly buttons: HTMLButtonElement[];
  private readonly listeners = new AbortController();
  private readonly resizeObserver = new ResizeObserver(() => {
    clearTimeout(this.resizeDebounceTimeout);
    this.resizeDebounceTimeout = setTimeout(() => this.clampPosition(), OBSERVER.DEBOUNCE_MS);
  });
  private readonly positionCheckInterval = setInterval(() => this.verifyAndRepairPosition(), POSITION_CHECK_INTERVAL_MS);
  private resizeDebounceTimeout?: ReturnType<typeof setTimeout>;
  private osdTimeout?: ReturnType<typeof setTimeout>;

  private hidden: boolean;
  private destroyed = false;
  private positionedParent: HTMLElement | null = null;
  private positionX: number = CONTROLLER.DEFAULT_OFFSET_X;
  private positionY: number = CONTROLLER.DEFAULT_OFFSET_Y;
  private drag: { pointerId: number; offsetX: number; offsetY: number; bounds: Bounds | null } | null = null;

  private targetSpeed: number;
  private isEnforcingSpeed = false;
  private suppressRateEnforcementCount = 0;
  private lastEnforcementTime = 0;
  private speedRequest = 0;
  private intendedSpeedListener: ((speed: number) => void) | null = null;

  constructor(
    readonly media: HTMLMediaElement,
    private settings: Settings,
    private readonly siteHandler: SiteHandler | null = null,
  ) {
    this.hidden = settings.startHidden;
    this.targetSpeed = safeMedia.getPlaybackRate(media);

    const shadow = this.wrapper.attachShadow({ mode: 'open' });
    // Firefox content scripts throw "Accessing from Xray wrapper" on adoptedStyleSheets; fall back to <style>.
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1411641
    try {
      shadow.adoptedStyleSheets = [getStyleSheet()];
    } catch {
      const style = document.createElement('style');
      style.textContent = controllerCSS;
      shadow.append(style);
    }
    this.wrapper.id = this.id;
    this.wrapper.style.setProperty('--hare-z-index', String(CONTROLLER.Z_INDEX));

    const { signal } = this.listeners;
    this.speedDisplay.className = 'hare-speed';
    this.speedDisplay.setAttribute('role', 'status');
    this.speedDisplay.setAttribute('aria-live', 'polite');
    this.speedDisplay.setAttribute('aria-label', 'Current playback speed');
    this.speedDisplay.tabIndex = 0;
    this.speedDisplay.addEventListener('pointerdown', this.handleDragStart, { signal });
    this.speedDisplay.addEventListener('pointermove', this.handleDragMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.speedDisplay.addEventListener(type, this.handleDragEnd, { signal });
    }
    this.updateSpeedDisplay();

    this.buttons = BUTTONS.map(([icon, action, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hare-btn';
      button.dataset.action = action;
      button.setAttribute('aria-label', label);
      button.append(createIcon(icon));
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (action === 'display') this.toggleVisibility();
        else if (action === 'rewind' || action === 'advance') this.seek((action === 'rewind' ? -1 : 1) * this.valueFor(action));
        else this.adjustSpeed((action === 'slower' ? -1 : 1) * this.valueFor(action));
      }, { signal });
      return button;
    });
    const controls = document.createElement('span');
    controls.className = 'hare-controls';
    controls.append(...this.buttons);

    this.controllerEl.className = 'hare-controller';
    this.controllerEl.addEventListener('mouseenter', () => this.clampPosition(), { signal });
    this.controllerEl.addEventListener('focusin', () => this.clampPosition(), { signal });
    this.controllerEl.append(this.speedDisplay, controls);
    this.applyAppearance();
    this.renderVisibility();

    this.osdEl.className = 'hare-osd';
    this.osdEl.setAttribute('role', 'status');
    shadow.append(this.controllerEl, this.osdEl);

    media.addEventListener('ratechange', this.handleRateChange, { capture: true, signal });
    document.addEventListener('fullscreenchange', () => {
      this.insertController();
      this.clampPosition();
    }, { signal });
    window.addEventListener('blur', this.handleDragEnd, { signal });

    this.insertController();
    this.applyPosition();
  }

  get speed(): number {
    return safeMedia.getPlaybackRate(this.media);
  }

  /** The user-intended playback speed, independent of any active sync rate correction. */
  get intendedSpeed(): number {
    return this.targetSpeed;
  }

  setIntendedSpeedListener(listener: ((speed: number) => void) | null): void {
    this.intendedSpeedListener = listener;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.applyAppearance();
    this.clampPosition();
  }

  updateSpeedDisplay(): void {
    this.speedDisplay.textContent = formatSpeed(this.speed);
  }

  /** Sets the user-intended speed and keeps enforcing it; warns when the player rejects or limits it. */
  setSpeed(speed: number): boolean {
    if (this.destroyed || !Number.isFinite(speed)) return false;
    const roundedSpeed = Math.round(clamp(speed, SPEED.MIN, SPEED.MAX) * 100) / 100;
    const previousSpeed = this.speed;
    try {
      safeMedia.setPlaybackRate(this.media, roundedSpeed);
    } catch {
      this.showOSD(SPEED_BLOCKED);
      return false;
    }
    this.targetSpeed = roundedSpeed;
    this.isEnforcingSpeed = roundedSpeed !== SPEED.DEFAULT;
    this.updateSpeedDisplay();
    this.intendedSpeedListener?.(roundedSpeed);

    const request = ++this.speedRequest;
    requestAnimationFrame(() => {
      if (this.destroyed || request !== this.speedRequest) return;
      const actualSpeed = this.speed;
      if (Math.abs(actualSpeed - roundedSpeed) <= SPEED.TOLERANCE) return;
      this.showOSD(Math.abs(actualSpeed - previousSpeed) < SPEED.TOLERANCE
        ? SPEED_BLOCKED
        : `Speed limited to ${formatSpeed(actualSpeed)}`);
    });
    return true;
  }

  adjustSpeed(delta: number): void {
    this.setSpeed(this.speed + delta);
  }

  /** Corrects drift without changing the user's intended speed. */
  applyTransientRate(speed: number): void {
    if (this.destroyed) return;
    const clampedSpeed = clamp(speed, SPEED.MIN, SPEED.MAX);
    if (this.speed !== clampedSpeed) {
      this.suppressRateEnforcementCount++;
      try { safeMedia.setPlaybackRate(this.media, clampedSpeed); }
      catch (error) { this.suppressRateEnforcementCount--; throw error; }
    }
    this.updateSpeedDisplay();
  }

  seek(seconds: number): void {
    if (this.destroyed || !Number.isFinite(seconds) || this.media.readyState < HTMLMediaElement.HAVE_METADATA) return;
    safeMedia.setCurrentTime(this.media, safeMedia.getCurrentTime(this.media) + seconds);
  }

  /** Runs a shortcut or forwarded button action, with on-screen feedback for speed changes. */
  perform(action: KeyAction, value: number): void {
    switch (action) {
      case 'slower': this.adjustSpeed(-value); break;
      case 'faster': this.adjustSpeed(value); break;
      case 'reset': this.setSpeed(value); break;
      case 'rewind': this.seek(-value); return;
      case 'advance': this.seek(value); return;
      case 'display': this.toggleVisibility(); return;
    }
    this.showOSD(formatSpeed(this.speed));
  }

  toggleVisibility(): void {
    this.hidden = !this.hidden;
    this.renderVisibility();
  }

  showOSD(message: string): void {
    clearTimeout(this.osdTimeout);
    this.osdEl.textContent = message;
    this.osdEl.classList.add('show');
    this.osdTimeout = setTimeout(() => this.osdEl.classList.remove('show'), UI.OSD_FADE_MS);
  }

  /** Viewport button bounds and actions, for clicks forwarded by a host frame. */
  getButtonHitmap(): HitmapButton[] {
    if (this.destroyed || this.hidden) return [];
    return this.buttons.flatMap(button => {
      const rect = button.getBoundingClientRect();
      const action = button.dataset.action as KeyAction;
      return rect.width > 0 && rect.height > 0
        ? [{ controllerId: this.id, action, value: this.valueFor(action), x: rect.left, y: rect.top, w: rect.width, h: rect.height }]
        : [];
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.handleDragEnd();
    this.destroyed = true;
    this.isEnforcingSpeed = false;
    this.intendedSpeedListener = null;
    this.listeners.abort();
    this.resizeObserver.disconnect();
    clearTimeout(this.osdTimeout);
    clearTimeout(this.resizeDebounceTimeout);
    clearInterval(this.positionCheckInterval);
    this.wrapper.remove();
    this.releasePositioningContext();
  }

  /** Settings are normalized, so every action has a binding. */
  private valueFor(action: KeyAction): number {
    return this.settings.keyBindings.find(binding => binding.action === action)!.value;
  }

  private applyAppearance(): void {
    this.controllerEl.style.setProperty('--hare-opacity', String(this.settings.controllerOpacity));
    this.controllerEl.style.setProperty('--hare-font-size', `${this.settings.controllerButtonSize}px`);
  }

  private renderVisibility(): void {
    this.controllerEl.classList.toggle('hidden', this.hidden);
    this.buttons.at(-1)!.setAttribute('aria-pressed', String(this.hidden));
  }

  private applyPosition(): void {
    this.wrapper.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  }

  // Throttle reactive rate writes to avoid fighting player scripts.
  private enforceSpeedIfNeeded(): void {
    if (!this.isEnforcingSpeed) return;
    const now = Date.now();
    if (now - this.lastEnforcementTime < ENFORCEMENT_DEBOUNCE_MS) return;
    if (Math.abs(this.speed - this.targetSpeed) <= SPEED.TOLERANCE) return;
    this.lastEnforcementTime = now;
    try {
      safeMedia.setPlaybackRate(this.media, this.targetSpeed);
    } catch (error) {
      logger.debug('Speed enforcement failed (may be DRM-protected):', error);
    }
  }

  private handleRateChange = (event: Event): void => {
    const isTransient = this.suppressRateEnforcementCount > 0;
    if (isTransient) this.suppressRateEnforcementCount--;
    // Prevent player listeners from resetting the requested rate.
    if (this.isEnforcingSpeed || isTransient) event.stopImmediatePropagation();
    this.updateSpeedDisplay();
    if (isTransient) return;
    if (!this.isEnforcingSpeed) this.targetSpeed = this.speed;
    this.enforceSpeedIfNeeded();
  };

  // Repair positioning after dynamic player DOM changes.
  private verifyAndRepairPosition(): void {
    if (!this.media.isConnected) return;
    const parent = this.wrapper.parentElement;
    const expectedParent = this.getControllerPosition()?.target ?? this.media.parentElement;
    if (!this.wrapper.isConnected || !parent || (expectedParent && parent !== expectedParent)) {
      this.insertController();
      return;
    }
    if (parent !== document.body && this.wrapper.offsetParent !== parent) {
      const style = getComputedStyle(parent);
      if (style.position === 'static' && style.transform === 'none') this.ensurePositioningContext(parent);
      else this.insertController();
    }
  }

  private getControllerPosition(): ControllerPosition | null {
    const fullscreen = document.fullscreenElement;
    if (fullscreen && fullscreen !== this.media && fullscreen.contains(this.media)) {
      return { target: fullscreen, method: 'append' };
    }
    const target = this.media instanceof HTMLVideoElement ? this.siteHandler?.findContainer(this.media) : null;
    // Video elements cannot display DOM children (e.g. a .vjs-tech selector).
    return target && !(target instanceof HTMLMediaElement) ? { target, method: 'prepend' } : null;
  }

  private insertController(): void {
    const position = this.getControllerPosition();
    if (position?.target.isConnected) {
      const target = position.target as HTMLElement;
      this.ensurePositioningContext(target);
      if (this.wrapper.parentNode !== target) target[position.method](this.wrapper);
    } else if (this.media.parentElement) {
      const parent = this.media.parentElement;
      this.ensurePositioningContext(parent);
      if (this.wrapper.parentNode !== parent) parent.prepend(this.wrapper);
    } else if (this.media.parentNode instanceof ShadowRoot) {
      this.media.before(this.wrapper);
    }

    this.resizeObserver.disconnect();
    clearTimeout(this.resizeDebounceTimeout);
    if (this.wrapper.parentElement) this.resizeObserver.observe(this.wrapper.parentElement);
  }

  /** Shared parents get `position: relative` while any controller needs it, then their own value back. */
  private ensurePositioningContext(parent: HTMLElement): void {
    if (this.positionedParent !== parent) {
      this.releasePositioningContext();
      const existing = positionedParents.get(parent);
      if (existing) {
        existing.count++;
        this.positionedParent = parent;
      }
    }
    if (getComputedStyle(parent).position !== 'static') return;
    if (!this.positionedParent) {
      positionedParents.set(parent, { count: 1, value: parent.style.getPropertyValue('position'), priority: parent.style.getPropertyPriority('position') });
      this.positionedParent = parent;
    }
    parent.style.position = 'relative';
  }

  private releasePositioningContext(): void {
    const parent = this.positionedParent;
    this.positionedParent = null;
    if (!parent) return;
    const lease = positionedParents.get(parent);
    if (!lease || --lease.count > 0) return;
    if (parent.style.position === 'relative' && parent.style.getPropertyPriority('position') === '') {
      if (lease.value) parent.style.setProperty('position', lease.value, lease.priority);
      else parent.style.removeProperty('position');
    }
    positionedParents.delete(parent);
  }

  /** Converts viewport pixels into the containing block's CSS coordinates. */
  private getPositionGeometry() {
    const parent = this.wrapper.offsetParent instanceof HTMLElement ? this.wrapper.offsetParent : this.wrapper.parentElement;
    if (!parent) return null;
    const rect = parent.getBoundingClientRect();
    const scaleX = parent.offsetWidth && rect.width ? rect.width / parent.offsetWidth : 1;
    const scaleY = parent.offsetHeight && rect.height ? rect.height / parent.offsetHeight : 1;
    return {
      parent, scaleX, scaleY,
      left: rect.left + (parent.clientLeft - parent.scrollLeft) * scaleX,
      top: rect.top + (parent.clientTop - parent.scrollTop) * scaleY,
    };
  }

  /** Keeps the expanded controls within the media box, in local CSS coordinates. */
  private getClampedBounds(): Bounds | null {
    const geometry = this.getPositionGeometry();
    if (!geometry) return null;
    const { parent, scaleX, scaleY, left, top } = geometry;
    let minX = parent.scrollLeft;
    let minY = parent.scrollTop;
    let maxX = minX + (parent.clientWidth || parent.offsetWidth || window.innerWidth / scaleX);
    let maxY = minY + (parent.clientHeight || parent.offsetHeight || window.innerHeight / scaleY);

    // Site-specific containers often extend beyond the video, so clamp to the video itself.
    const videoRect = this.media.getBoundingClientRect();
    if (videoRect.width > 0 && videoRect.height > 0) {
      minX = Math.max(minX, (videoRect.left - left) / scaleX);
      minY = Math.max(minY, (videoRect.top - top) / scaleY);
      maxX = Math.min(maxX, (videoRect.right - left) / scaleX);
      maxY = Math.min(maxY, (videoRect.bottom - top) / scaleY);
    }

    const padding = CONTROLLER.BOUNDARY_PADDING;
    // Wrap controls before measuring them, including large buttons on narrow players.
    this.controllerEl.style.setProperty('--hare-max-width', `${Math.max(0, maxX - minX - padding * 2)}px`);
    const controllerRect = this.controllerEl.getBoundingClientRect();
    return {
      minX: minX + padding,
      maxX: Math.max(minX + padding, maxX - controllerRect.width / scaleX - padding),
      minY: minY + padding,
      maxY: Math.max(minY + padding, maxY - controllerRect.height / scaleY - padding),
    };
  }

  private clampPosition(): void {
    if (this.destroyed || this.drag) return;
    const bounds = this.getClampedBounds();
    if (!bounds) return;
    const x = clamp(this.positionX, bounds.minX, bounds.maxX);
    const y = clamp(this.positionY, bounds.minY, bounds.maxY);
    if (x === this.positionX && y === this.positionY) return;
    this.positionX = x;
    this.positionY = y;
    this.applyPosition();
  }

  private handleDragStart = (event: PointerEvent): void => {
    if (event.button !== 0 || this.drag || !this.media.isConnected) return;
    const geometry = this.getPositionGeometry();
    if (!geometry) return;
    event.preventDefault();
    event.stopPropagation();
    this.speedDisplay.setPointerCapture(event.pointerId);
    this.controllerEl.classList.add('dragging');
    this.drag = {
      pointerId: event.pointerId,
      offsetX: (event.clientX - geometry.left) / geometry.scaleX - this.positionX,
      offsetY: (event.clientY - geometry.top) / geometry.scaleY - this.positionY,
      bounds: this.getClampedBounds(),
    };
  };

  private handleDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (event.pointerId !== drag?.pointerId) return;
    if (!this.media.isConnected) {
      this.handleDragEnd();
      return;
    }
    event.preventDefault();
    const geometry = this.getPositionGeometry();
    if (!geometry || !drag.bounds) return;
    this.positionX = clamp((event.clientX - geometry.left) / geometry.scaleX - drag.offsetX, drag.bounds.minX, drag.bounds.maxX);
    this.positionY = clamp((event.clientY - geometry.top) / geometry.scaleY - drag.offsetY, drag.bounds.minY, drag.bounds.maxY);
    this.applyPosition();
  };

  private handleDragEnd = (event?: Event): void => {
    const pointerId = this.drag?.pointerId;
    if (pointerId === undefined) return;
    if (event instanceof PointerEvent && event.pointerId !== pointerId) return;
    this.drag = null;
    this.controllerEl.classList.remove('dragging');
    if (this.speedDisplay.hasPointerCapture(pointerId)) this.speedDisplay.releasePointerCapture(pointerId);
  };
}
