import { SPEED, CONTROLLER, UI, OBSERVER, SEEK } from './constants';
import type { Settings, SiteHandler, ControllerPosition, KeyAction } from './types';
import type { HitmapButton } from './cross-frame-pointer';
import controllerCSS from '../assets/controller.css?raw';
import { logger } from './logger';
import { MESSAGES } from './messages';
import { BrowserFeatures } from './browser-detect';
import { safeMedia } from './safe-media';
import { ICONS } from './controller-icons';

let sharedStyleSheet: CSSStyleSheet | null = null;

function getStyleSheet(): CSSStyleSheet {
  if (!sharedStyleSheet) {
    sharedStyleSheet = new CSSStyleSheet();
    sharedStyleSheet.replaceSync(controllerCSS);
  }
  return sharedStyleSheet;
}

let controllerIdCounter = 0;
const positionedParents = new WeakMap<HTMLElement, { count: number; value: string; priority: string }>();

const svgCache: Record<string, SVGElement> = {};

export class VideoController {
  readonly id: string;
  readonly media: HTMLMediaElement;

  private wrapper: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private speedDisplay: HTMLElement | null = null;
  private controllerEl: HTMLElement | null = null;
  private osdEl: HTMLElement | null = null;
  private hideBtn: HTMLButtonElement | null = null;
  private osdTimeout: NodeJS.Timeout | null = null;
  private isManuallyHidden = false;
  private settings: Settings;
  private siteHandler: SiteHandler | null;

  private dragPointerId: number | null = null;
  private listeners = new AbortController();
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private positionX = 0;
  private positionY = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimeout: NodeJS.Timeout | null = null;
  private positionCheckInterval: NodeJS.Timeout | null = null;
  private static readonly POSITION_CHECK_INTERVAL_MS = 2000;

  private cachedSpeedStep: number = SPEED.STEP;
  private cachedSeekValue: number = SEEK.DEFAULT_SECONDS;
  private cachedSlowerStep: number = SPEED.STEP;
  private cachedRewindValue: number = SEEK.DEFAULT_SECONDS;
  private destroyed = false;
  private positionedParent: HTMLElement | null = null;
  private speedRequest = 0;

  private targetSpeed: number = SPEED.DEFAULT;
  private isEnforcingSpeed = false;
  private suppressRateEnforcementCount = 0;
  private lastEnforcementTime = 0;
  private static readonly ENFORCEMENT_DEBOUNCE_MS = 500;

  private dragBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  private intendedSpeedListener: ((speed: number) => void) | null = null;

  constructor(
    media: HTMLMediaElement,
    settings: Settings,
    siteHandler: SiteHandler | null = null
  ) {
    this.id = `hare-${++controllerIdCounter}`;
    this.media = media;
    this.settings = settings;
    this.siteHandler = siteHandler;
    this.isManuallyHidden = settings.startHidden;
    this.targetSpeed = safeMedia.getPlaybackRate(media);

    this.positionX = CONTROLLER.DEFAULT_OFFSET_X;
    this.positionY = CONTROLLER.DEFAULT_OFFSET_Y;

    this.cacheKeybindingValues();
    this.init();
  }

  private cacheKeybindingValues(): void {
    const fasterBinding = this.settings.keyBindings.find((b) => b.action === 'faster');
    const advanceBinding = this.settings.keyBindings.find((b) => b.action === 'advance');
    this.cachedSpeedStep = fasterBinding?.value ?? SPEED.STEP;
    this.cachedSeekValue = advanceBinding?.value ?? SEEK.DEFAULT_SECONDS;
    this.cachedSlowerStep = this.settings.keyBindings.find(b => b.action === 'slower')?.value ?? SPEED.STEP;
    this.cachedRewindValue = this.settings.keyBindings.find(b => b.action === 'rewind')?.value ?? SEEK.DEFAULT_SECONDS;
  }

  private init(): void {
    this.createController();

    const { signal } = this.listeners;
    this.media.addEventListener('ratechange', this.handleRateChange, { capture: true, signal });
    this.media.addEventListener('play', this.handlePlay, { signal });
    document.addEventListener('fullscreenchange', this.handleFullscreenChange, { signal });
    window.addEventListener('blur', this.handleDragEnd, { signal });

    if (safeMedia.getPlaybackRate(this.media) !== SPEED.DEFAULT) {
      this.updateSpeedDisplay();
    }

    this.startPositionCheck();
  }

  // Repair positioning after dynamic player DOM changes.
  private startPositionCheck(): void {
    this.positionCheckInterval = setInterval(() => {
      this.verifyAndRepairPosition();
    }, VideoController.POSITION_CHECK_INTERVAL_MS);
  }

  private verifyAndRepairPosition(): void {
    if (!this.wrapper || !this.media.isConnected) return;

    if (!this.wrapper.isConnected) {
      this.insertController();
      return;
    }

    const parent = this.wrapper.parentElement;

    // If wrapper has no parent but is connected, it's in a document fragment - reinsert
    if (!parent) {
      this.insertController();
      return;
    }

    const position = this.getControllerPosition();
    const expectedParent = position
      ? (position.method === 'before' || position.method === 'after' ? position.target.parentElement : position.target)
      : this.media.parentElement;
    if (parent !== expectedParent && expectedParent) {
      this.insertController();
      return;
    }

    if (parent !== document.body && this.wrapper.offsetParent !== parent) {
      const style = getComputedStyle(parent);
      if (style.position === 'static' && style.transform === 'none') {
        this.ensurePositioningContext(parent);
      } else {
        this.insertController();
      }
    }
  }

  private createController(): void {
    this.wrapper = document.createElement(CONTROLLER.ELEMENT_TAG);
    this.wrapper.id = this.id;

    this.shadow = this.wrapper.attachShadow({ mode: 'open' });

    // Firefox content scripts throw "Accessing from Xray wrapper" when setting adoptedStyleSheets
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1411641
    // Workaround: Fall back to <style> tag injection
    try {
      this.shadow.adoptedStyleSheets = [getStyleSheet()];
    } catch (error) {
      logger.debug('adoptedStyleSheets not available, using <style> fallback:', error);
      const styleEl = document.createElement('style');
      styleEl.textContent = controllerCSS;
      this.shadow.appendChild(styleEl);
    }

    this.controllerEl = document.createElement('div');
    this.controllerEl.className = 'hare-controller';
    this.controllerEl.addEventListener('mouseenter', () => this.clampPosition());
    this.controllerEl.addEventListener('focusin', () => this.clampPosition());
    if (this.isManuallyHidden) {
      this.controllerEl.classList.add('hidden');
    }

    this.controllerEl.style.setProperty('--hare-opacity', String(this.settings.controllerOpacity));
    this.controllerEl.style.setProperty('--hare-font-size', `${this.settings.controllerButtonSize}px`);
    this.wrapper.style.setProperty('--hare-z-index', String(CONTROLLER.Z_INDEX));

    this.speedDisplay = document.createElement('span');
    this.speedDisplay.className = 'hare-speed';
    this.speedDisplay.textContent = this.formatSpeed(safeMedia.getPlaybackRate(this.media));
    this.speedDisplay.setAttribute('role', 'status');
    this.speedDisplay.setAttribute('aria-live', 'polite');
    this.speedDisplay.setAttribute('aria-label', 'Current playback speed');
    this.speedDisplay.setAttribute('tabindex', '0');

    const { signal } = this.listeners;
    this.speedDisplay.addEventListener('pointerdown', this.handleDragStart, { signal });
    this.speedDisplay.addEventListener('pointermove', this.handleDragMove, { signal });
    this.speedDisplay.addEventListener('pointerup', this.handleDragEnd, { signal });
    this.speedDisplay.addEventListener('pointercancel', this.handleDragEnd, { signal });
    this.speedDisplay.addEventListener('lostpointercapture', this.handleDragEnd, { signal });

    const controls = document.createElement('span');
    controls.className = 'hare-controls';

    const rewindBtn = this.createButton(ICONS.rewind, 'rewind', () => this.seek(-this.cachedRewindValue), 'Rewind');
    const slowerBtn = this.createButton(ICONS.slower, 'slower', () => this.adjustSpeed(-this.cachedSlowerStep), 'Slower');
    const fasterBtn = this.createButton(ICONS.faster, 'faster', () => this.adjustSpeed(this.cachedSpeedStep), 'Faster');
    const advanceBtn = this.createButton(ICONS.advance, 'advance', () => this.seek(this.cachedSeekValue), 'Advance');

    const hideBtn = this.createButton(ICONS.hide, 'display', () => this.toggleVisibility(), 'Hide controller');
    hideBtn.classList.add('hare-btn-hide');
    hideBtn.setAttribute('aria-pressed', String(this.isManuallyHidden));
    this.hideBtn = hideBtn;

    controls.append(rewindBtn, slowerBtn, fasterBtn, advanceBtn, hideBtn);
    this.controllerEl.append(this.speedDisplay, controls);

    this.osdEl = document.createElement('div');
    this.osdEl.className = 'hare-osd';
    this.osdEl.setAttribute('role', 'status');
    this.osdEl.textContent = '';

    this.shadow.appendChild(this.controllerEl);
    this.shadow.appendChild(this.osdEl);

    this.insertController();
    this.wrapper!.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  }

  private createSVGFromString(svgString: string): SVGElement | null {
    if (svgCache[svgString]) {
      return svgCache[svgString].cloneNode(true) as SVGElement;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${svgString}</body>`, 'text/html');
    const svgElement = doc.body.querySelector('svg');

    if (svgElement) {
      const importedNode = document.importNode(svgElement, true) as SVGElement;
      svgCache[svgString] = importedNode;
      return importedNode.cloneNode(true) as SVGElement;
    }
    return null;
  }

  private createButton(
    iconSvg: string,
    action: string,
    onClick: () => void,
    ariaLabel: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hare-btn';

    const svgElement = this.createSVGFromString(iconSvg);
    if (svgElement) {
      btn.appendChild(svgElement);
    }

    btn.dataset.action = action;
    btn.setAttribute('aria-label', ariaLabel);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
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
    const style = getComputedStyle(parent);
    if (style.position === 'static') {
      if (!this.positionedParent) {
        positionedParents.set(parent, { count: 1, value: parent.style.getPropertyValue('position'), priority: parent.style.getPropertyPriority('position') });
        this.positionedParent = parent;
      }
      parent.style.position = 'relative';
    }
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

  private insertController(): void {
    if (!this.wrapper) return;

    let position = this.getControllerPosition();

    if (position) {
      const target = position.target as HTMLElement;

      if (!target.isConnected) {
        logger.debug('Site handler returned disconnected element, using fallback positioning');
        position = null;
      } else {
        const parent = position.method === 'before' || position.method === 'after' ? target.parentElement : target;
        if (parent) this.ensurePositioningContext(parent);

        switch (position.method) {
          case 'prepend': if (this.wrapper.parentNode !== target) target.prepend(this.wrapper); break;
          case 'append': if (this.wrapper.parentNode !== target) target.append(this.wrapper); break;
          case 'before': if (this.wrapper.nextSibling !== target) target.before(this.wrapper); break;
          case 'after': if (this.wrapper.previousSibling !== target) target.after(this.wrapper); break;
        }
      }
    }

    if (!position) {
      const parent = this.media.parentElement;
      if (parent) {
        this.ensurePositioningContext(parent);
        if (this.wrapper.parentNode !== parent) parent.prepend(this.wrapper);
      } else if (this.media.parentNode instanceof ShadowRoot) {
        this.media.before(this.wrapper);
      }
    }

    this.setupResizeObserver();
  }

  private getControllerPosition(): ControllerPosition | null {
    const fullscreen = document.fullscreenElement;
    if (fullscreen && fullscreen !== this.media && fullscreen.contains(this.media)) {
      return { target: fullscreen, method: 'append' };
    }
    const position = this.media instanceof HTMLVideoElement
      ? this.siteHandler?.getControllerPosition(this.media) : null;
    // Video elements cannot display DOM children (e.g. a .vjs-tech selector).
    return position?.target instanceof HTMLMediaElement ? null : position ?? null;
  }

  private handleFullscreenChange = (): void => {
    this.insertController();
    this.clampPosition();
  };

  private setupResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
      this.resizeDebounceTimeout = null;
    }

    const parent = this.wrapper?.parentElement;
    if (!parent) return;

    if (!BrowserFeatures.hasResizeObserver) {
      logger.debug('ResizeObserver not available - controller position may not adjust on resize');
      return;
    }

    try {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeDebounceTimeout) {
          clearTimeout(this.resizeDebounceTimeout);
        }
        this.resizeDebounceTimeout = setTimeout(() => {
          this.clampPosition();
          this.resizeDebounceTimeout = null;
        }, OBSERVER.DEBOUNCE_MS);
      });
      this.resizeObserver.observe(parent);
    } catch (error) {
      logger.warn('ResizeObserver failed:', error);
    }
  }

  /** Convert viewport pixels into the containing block's CSS coordinates. */
  private getPositionGeometry() {
    const parent = this.wrapper?.offsetParent instanceof HTMLElement
      ? this.wrapper.offsetParent : this.wrapper?.parentElement;
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

  /** Keep the expanded controls within the media box, in local CSS coordinates. */
  private getClampedBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (!this.wrapper || !this.controllerEl) return null;
    const geometry = this.getPositionGeometry();
    if (!geometry) return null;
    const { parent, scaleX, scaleY, left, top } = geometry;
    let minX = parent.scrollLeft;
    let minY = parent.scrollTop;
    let maxX = minX + (parent.clientWidth || parent.offsetWidth || window.innerWidth / scaleX);
    let maxY = minY + (parent.clientHeight || parent.offsetHeight || window.innerHeight / scaleY);

    // Site-specific containers often extend beyond the video; we clamp to the actual video element.
    const videoRect = this.media.getBoundingClientRect();
    if (videoRect.width > 0 && videoRect.height > 0) {
      minX = Math.max(minX, (videoRect.left - left) / scaleX);
      minY = Math.max(minY, (videoRect.top - top) / scaleY);
      maxX = Math.min(maxX, (videoRect.right - left) / scaleX);
      maxY = Math.min(maxY, (videoRect.bottom - top) / scaleY);
    }

    // Wrap controls before measuring them, including large buttons on narrow players.
    this.controllerEl.style.setProperty('--hare-max-width', `${Math.max(0, maxX - minX - CONTROLLER.BOUNDARY_PADDING * 2)}px`);
    const controllerRect = this.controllerEl.getBoundingClientRect();
    const controllerWidth = controllerRect.width / scaleX;
    const controllerHeight = controllerRect.height / scaleY;

    const padding = CONTROLLER.BOUNDARY_PADDING;

    return {
      minX: minX + padding,
      maxX: Math.max(minX + padding, maxX - controllerWidth - padding),
      minY: minY + padding,
      maxY: Math.max(minY + padding, maxY - controllerHeight - padding),
    };
  }

  private clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
  }

  private clampPosition(): void {
    if (!this.wrapper || this.dragPointerId !== null) return;

    const bounds = this.getClampedBounds();
    if (!bounds) return;

    const newX = this.clampValue(this.positionX, bounds.minX, bounds.maxX);
    const newY = this.clampValue(this.positionY, bounds.minY, bounds.maxY);

    if (newX !== this.positionX || newY !== this.positionY) {
      this.positionX = newX;
      this.positionY = newY;
      this.wrapper.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
    }
  }

  private formatSpeed(speed: number): string {
    return speed.toFixed(2) + 'x';
  }

  private handleRateChange = (e: Event): void => {
    const shouldSkipEnforcement = this.suppressRateEnforcementCount > 0;
    if (shouldSkipEnforcement) {
      this.suppressRateEnforcementCount--;
    }

    if (this.isEnforcingSpeed || shouldSkipEnforcement) {
      // Prevent player listeners from resetting the requested rate.
      e.stopImmediatePropagation();
    }
    this.updateSpeedDisplay();
    if (shouldSkipEnforcement) return;
    if (!this.isEnforcingSpeed) this.targetSpeed = safeMedia.getPlaybackRate(this.media);
    this.enforceSpeedIfNeeded();
  };

  private handlePlay = (): void => {
    if (!this.isManuallyHidden && this.controllerEl?.classList.contains('hidden')) {
      this.controllerEl.classList.remove('hidden');
    }
  };

  private handleDragStart = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (!this.wrapper) return;

    if (!this.media.isConnected) {
      this.destroy();
      return;
    }

    if (this.dragPointerId !== null) return;
    const geometry = this.getPositionGeometry();
    if (!geometry) return;

    e.preventDefault();
    e.stopPropagation();

    this.speedDisplay!.setPointerCapture(e.pointerId);
    this.dragPointerId = e.pointerId;
    this.controllerEl?.classList.add('dragging');
    this.dragBounds = this.getClampedBounds();

    this.dragOffsetX = (e.clientX - geometry.left) / geometry.scaleX - this.positionX;
    this.dragOffsetY = (e.clientY - geometry.top) / geometry.scaleY - this.positionY;
  };

  private handleDragMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointerId || !this.wrapper) return;

    if (!this.media.isConnected) {
      this.handleDragEnd();
      return;
    }

    e.preventDefault();

    const geometry = this.getPositionGeometry();
    const bounds = this.dragBounds;
    if (!geometry || !bounds) return;

    const newX = (e.clientX - geometry.left) / geometry.scaleX - this.dragOffsetX;
    const newY = (e.clientY - geometry.top) / geometry.scaleY - this.dragOffsetY;

    this.positionX = this.clampValue(newX, bounds.minX, bounds.maxX);
    this.positionY = this.clampValue(newY, bounds.minY, bounds.maxY);
    this.wrapper.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  };

  private handleDragEnd = (event?: Event): void => {
    if (this.dragPointerId === null) return;
    if (event instanceof PointerEvent && event.pointerId !== this.dragPointerId) return;

    const pointerId = this.dragPointerId;
    this.dragPointerId = null;
    this.dragBounds = null;
    this.controllerEl?.classList.remove('dragging');
    if (this.speedDisplay?.hasPointerCapture(pointerId)) {
      this.speedDisplay.releasePointerCapture(pointerId);
    }
  };

  updateSpeedDisplay(): void {
    if (this.speedDisplay) {
      this.speedDisplay.textContent = this.formatSpeed(safeMedia.getPlaybackRate(this.media));
    }
  }

  // Notify the user when the player rejects or limits the requested speed.
  setSpeed(speed: number): boolean {
    if (this.destroyed || !Number.isFinite(speed)) return false;
    const clampedSpeed = Math.max(SPEED.MIN, Math.min(SPEED.MAX, speed));
    const roundedSpeed = Math.round(clampedSpeed * 100) / 100;

    const previousSpeed = safeMedia.getPlaybackRate(this.media);
    try {
      safeMedia.setPlaybackRate(this.media, roundedSpeed);
    } catch {
      this.showOSD(MESSAGES.SPEED_CONTROL_BLOCKED);
      return false;
    }
    this.targetSpeed = roundedSpeed;
    this.isEnforcingSpeed = roundedSpeed !== SPEED.DEFAULT;
    this.updateSpeedDisplay();
    this.intendedSpeedListener?.(roundedSpeed);

    const request = ++this.speedRequest;
    requestAnimationFrame(() => {
      if (this.destroyed || request !== this.speedRequest) return;
      const actualSpeed = safeMedia.getPlaybackRate(this.media);
      const tolerance = SPEED.TOLERANCE;

      if (Math.abs(actualSpeed - roundedSpeed) > tolerance) {
        if (Math.abs(actualSpeed - previousSpeed) < tolerance) {
          this.showOSD(MESSAGES.SPEED_CONTROL_BLOCKED);
        } else {
          this.showOSD(MESSAGES.SPEED_LIMITED(this.formatSpeed(actualSpeed)));
        }
      }
    });
    return true;
  }

  adjustSpeed(delta: number): void {
    this.setSpeed(safeMedia.getPlaybackRate(this.media) + delta);
  }

  resetSpeed(): void {
    this.isEnforcingSpeed = false;
    this.targetSpeed = SPEED.DEFAULT;
    this.setSpeed(SPEED.DEFAULT);
  }

  // Correct drift without changing the user's intended speed.
  applyTransientRate(speed: number): void {
    if (this.destroyed || !Number.isFinite(speed)) return;
    const clampedSpeed = Math.max(SPEED.MIN, Math.min(SPEED.MAX, speed));
    if (safeMedia.getPlaybackRate(this.media) !== clampedSpeed) {
      this.suppressRateEnforcementCount++;
      try { safeMedia.setPlaybackRate(this.media, clampedSpeed); }
      catch (error) { this.suppressRateEnforcementCount--; throw error; }
    }
    this.updateSpeedDisplay();
  }

  // Throttle reactive rate writes to avoid fighting player scripts.
  private enforceSpeedIfNeeded(): void {
    if (!this.isEnforcingSpeed) return;

    const now = Date.now();
    if (now - this.lastEnforcementTime < VideoController.ENFORCEMENT_DEBOUNCE_MS) {
      return; // Debounce to prevent loops
    }

    const tolerance = SPEED.TOLERANCE;
    if (Math.abs(safeMedia.getPlaybackRate(this.media) - this.targetSpeed) > tolerance) {
      try {
        this.lastEnforcementTime = now;
        safeMedia.setPlaybackRate(this.media, this.targetSpeed);
      } catch (error) {
        logger.debug('Speed enforcement failed (may be DRM-protected):', error);
        // Don't disable enforcement - retry on next ratechange
      }
    }
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds) || this.destroyed) return;
    if (this.media.readyState < HTMLMediaElement.HAVE_METADATA) return;

    try {
      const targetTime = safeMedia.getCurrentTime(this.media) + seconds;

      safeMedia.setCurrentTime(this.media, targetTime);
    } catch (error) {
      logger.error('Seek failed:', error);
    }
  }

  toggleVisibility(): void {
    this.isManuallyHidden = !this.isManuallyHidden;
    if (this.controllerEl) {
      this.controllerEl.classList.toggle('hidden', this.isManuallyHidden);
    }
    this.hideBtn?.setAttribute('aria-pressed', String(this.isManuallyHidden));
  }

  // Viewport button bounds and actions for clicks forwarded by a host frame.
  getButtonHitmap(): HitmapButton[] {
    if (!this.wrapper || !this.shadow || !this.controllerEl) return [];
    if (this.controllerEl.classList.contains('hidden')) return [];

    const buttons: HitmapButton[] = [];
    const btnEls = this.shadow.querySelectorAll<HTMLButtonElement>('button[data-action]');
    for (const btn of btnEls) {
      const r = btn.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const action = btn.dataset.action as KeyAction | undefined;
      if (!action) continue;
      const value =
        action === 'slower' ? this.cachedSlowerStep : action === 'faster' ? this.cachedSpeedStep
          : action === 'rewind' ? this.cachedRewindValue : action === 'advance' ? this.cachedSeekValue : 0;
      buttons.push({ controllerId: this.id, action, value, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return buttons;
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.cacheKeybindingValues();

    if (this.controllerEl) {
      this.controllerEl.style.setProperty('--hare-opacity', String(settings.controllerOpacity));
      this.controllerEl.style.setProperty('--hare-font-size', `${settings.controllerButtonSize}px`);
    }
    this.clampPosition();
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

  showOSD(message: string): void {
    if (!this.osdEl) return;

    if (this.osdTimeout) clearTimeout(this.osdTimeout);

    this.osdEl.textContent = message;
    this.osdEl.classList.add('show');

    this.osdTimeout = setTimeout(() => {
      this.osdEl?.classList.remove('show');
      this.osdTimeout = null;
    }, UI.OSD_FADE_MS);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.isEnforcingSpeed = false;

    this.listeners.abort();
    this.handleDragEnd();
    this.intendedSpeedListener = null;

    if (this.osdTimeout) clearTimeout(this.osdTimeout);
    if (this.resizeDebounceTimeout) clearTimeout(this.resizeDebounceTimeout);
    if (this.positionCheckInterval) clearInterval(this.positionCheckInterval);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.wrapper?.remove();
    this.releasePositioningContext();
    this.wrapper = null;
    this.shadow = null;
    this.speedDisplay = null;
    this.controllerEl = null;
    this.osdEl = null;
  }
}
