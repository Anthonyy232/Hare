import { SPEED, clampRate, clampSpeed, sameSpeed } from '../speed';
import type { Settings } from '../settings/schema';
import type { KeyAction } from '../settings/key-actions';
import type { HitmapButton, PointerTarget } from './controller-contracts';
import type { SiteHandler } from './site-handlers';
import controllerCSS from '../../assets/controller.css?raw';
import { logger } from '../logger';
import { safeMedia } from './safe-media';
import { CONTROLLER_TAG, applyAppearance, createControllerView } from './controller-view';

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

/** Events after which the media plays another source, or none. */
export const SOURCE_CHANGE_EVENTS = ['loadstart', 'emptied', 'error'];

let controllerIdCounter = 0;
const positionedParents = new WeakMap<HTMLElement, { count: number; value: string; priority: string }>();
const SPEED_BLOCKED = 'Speed control blocked';
const POSITION_CHECK_INTERVAL_MS = 2000;
const ENFORCEMENT_DEBOUNCE_MS = 500;
const RESIZE_DEBOUNCE_MS = 50;
const OSD_FADE_MS = 800;
const DEFAULT_OFFSET = 10;
const BOUNDARY_PADDING = 10;

type ControllerPosition = { target: Element; method: 'prepend' | 'append' };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export class VideoController implements PointerTarget {
  readonly id = `hare-${++controllerIdCounter}`;

  private readonly wrapper = document.createElement(CONTROLLER_TAG);
  private readonly view = createControllerView();
  private readonly controllerEl = this.view.controllerEl;
  private readonly speedDisplay = this.view.speedDisplay;
  private readonly buttons = this.view.buttons;
  private readonly osdEl = document.createElement('div');
  private readonly listeners = new AbortController();
  private readonly resizeObserver = new ResizeObserver(() => {
    clearTimeout(this.resizeDebounceTimeout);
    this.resizeDebounceTimeout = setTimeout(() => this.clampPosition(), RESIZE_DEBOUNCE_MS);
  });
  private readonly positionCheckInterval = setInterval(() => this.verifyAndRepairPosition(), POSITION_CHECK_INTERVAL_MS);
  private resizeDebounceTimeout?: ReturnType<typeof setTimeout>;
  private osdTimeout?: ReturnType<typeof setTimeout>;

  private hidden: boolean;
  private destroyed = false;
  private positionedParent: HTMLElement | null = null;
  private positionX = DEFAULT_OFFSET;
  private positionY = DEFAULT_OFFSET;
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
    private readonly siteHandler: SiteHandler,
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

    const { signal } = this.listeners;
    this.speedDisplay.addEventListener('pointerdown', this.handleDragStart, { signal });
    this.speedDisplay.addEventListener('pointermove', this.handleDragMove, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.speedDisplay.addEventListener(type, this.handleDragEnd, { signal });
    }
    this.updateSpeedDisplay();

    for (const [action, button] of this.buttons) {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.press(action);
      }, { signal });
    }
    this.controllerEl.addEventListener('mouseenter', () => this.clampPosition(), { signal });
    this.controllerEl.addEventListener('focusin', () => this.clampPosition(), { signal });
    applyAppearance(this.controllerEl, this.settings.controllerOpacity, this.settings.controllerButtonSize);
    this.renderVisibility();

    this.osdEl.className = 'hare-osd';
    this.osdEl.setAttribute('role', 'status');
    shadow.append(this.controllerEl, this.osdEl);

    media.addEventListener('ratechange', this.handleRateChange, { capture: true, signal });
    for (const type of SOURCE_CHANGE_EVENTS) {
      media.addEventListener(type, () => this.updateSpeedDisplay(), { signal });
    }
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
    applyAppearance(this.controllerEl, this.settings.controllerOpacity, this.settings.controllerButtonSize);
    this.clampPosition();
  }

  /** Returns false when the player refused the speed. */
  setSpeed(speed: number): boolean {
    if (this.destroyed || !Number.isFinite(speed)) return false;
    const roundedSpeed = clampSpeed(speed);
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
      if (sameSpeed(actualSpeed, roundedSpeed)) return;
      this.showOSD(sameSpeed(actualSpeed, previousSpeed)
        ? SPEED_BLOCKED
        : `Speed limited to ${formatSpeed(actualSpeed)}`);
    });
    return true;
  }

  applyTransientRate(speed: number): void {
    if (this.destroyed) return;
    const clampedSpeed = clampRate(speed);
    if (this.speed !== clampedSpeed) {
      this.suppressRateEnforcementCount++;
      try { safeMedia.setPlaybackRate(this.media, clampedSpeed); }
      catch (error) { this.suppressRateEnforcementCount--; throw error; }
    }
    this.updateSpeedDisplay();
  }

  perform(action: KeyAction, value: number): void {
    if (this.executeAction(action, value)) this.showOSD(formatSpeed(this.speed));
  }

  press(action: KeyAction): void {
    this.executeAction(action, this.valueFor(action));
  }

  private executeAction(action: KeyAction, value: number): boolean {
    switch (action) {
      case 'slower': return this.setSpeed(this.speed - value);
      case 'faster': return this.setSpeed(this.speed + value);
      case 'reset': return this.setSpeed(value);
      case 'rewind': this.seek(-value); return false;
      case 'advance': this.seek(value); return false;
      case 'display':
        this.hidden = !this.hidden;
        this.renderVisibility();
        return false;
    }
  }

  private seek(seconds: number): void {
    if (this.destroyed || !Number.isFinite(seconds) || this.media.readyState < HTMLMediaElement.HAVE_METADATA) return;
    safeMedia.setCurrentTime(this.media, safeMedia.getCurrentTime(this.media) + seconds);
  }

  private updateSpeedDisplay(): void {
    this.speedDisplay.textContent = formatSpeed(this.speed);
  }

  private showOSD(message: string): void {
    clearTimeout(this.osdTimeout);
    this.osdEl.textContent = message;
    this.osdEl.classList.add('show');
    this.osdTimeout = setTimeout(() => this.osdEl.classList.remove('show'), OSD_FADE_MS);
  }

  getButtonHitmap(): HitmapButton[] {
    if (this.destroyed || this.hidden) return [];
    return [...this.buttons].flatMap(([action, button]) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? [{ controllerId: this.id, action, x: rect.left, y: rect.top, w: rect.width, h: rect.height }]
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

  private renderVisibility(): void {
    this.controllerEl.classList.toggle('hidden', this.hidden);
    this.buttons.get('display')!.setAttribute('aria-pressed', String(this.hidden));
  }

  private applyPosition(): void {
    this.wrapper.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  }

  private enforceSpeedIfNeeded(): void {
    if (!this.isEnforcingSpeed) return;
    const now = Date.now();
    if (now - this.lastEnforcementTime < ENFORCEMENT_DEBOUNCE_MS) return;
    if (sameSpeed(this.speed, this.targetSpeed)) return;
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
    const target = this.media instanceof HTMLVideoElement ? this.siteHandler.findContainer(this.media) : null;
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

    const padding = BOUNDARY_PADDING;
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
