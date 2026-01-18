import { SPEED, CONTROLLER, UI, OBSERVER, SEEK } from './constants';
import type { Settings, SiteHandler, ControllerPosition } from './types';
import controllerCSS from '../assets/controller.css?raw';
import { logger } from './logger';
import { MESSAGES } from './messages';

let sharedStyleSheet: CSSStyleSheet | null = null;

/**
 * Lazily initializes and returns a shared CSSStyleSheet to be used across all instances.
 * Using adoptedStyleSheets is more memory-efficient than injecting <style> tags per instance.
 */
function getStyleSheet(): CSSStyleSheet {
  if (!sharedStyleSheet) {
    sharedStyleSheet = new CSSStyleSheet();
    try {
      sharedStyleSheet.replaceSync(controllerCSS);
    } catch (error) {
      logger.error('Failed to parse controller CSS:', error);
      sharedStyleSheet.replaceSync('');
    }
  }
  return sharedStyleSheet;
}

const ICONS = {
  rewind: `<svg viewBox="0 0 24 24"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>`,
  slower: `<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  faster: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  advance: `<svg viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>`,
  hide: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
};

let controllerIdCounter = 0;

/**
 * Manages the speed control UI and playback interaction for a specific media element.
 */
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

  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private positionX = 0;
  private positionY = 0;
  private hasInitializedDragPosition = false;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimeout: NodeJS.Timeout | null = null;
  private positionCheckInterval: NodeJS.Timeout | null = null;
  private static readonly POSITION_CHECK_INTERVAL_MS = 2000;

  // Cached values to avoid repeated Lookups during keybind execution
  private cachedSpeedStep: number = SPEED.STEP;
  private cachedSeekValue: number = SEEK.DEFAULT_SECONDS;


  // Speed enforcement: reactive enforcement to counter sites resetting speed
  private targetSpeed: number = SPEED.DEFAULT;
  private isEnforcingSpeed = false;
  private lastEnforcementTime = 0;
  private static readonly ENFORCEMENT_DEBOUNCE_MS = 500;

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

    this.positionX = CONTROLLER.DEFAULT_OFFSET_X;
    this.positionY = CONTROLLER.DEFAULT_OFFSET_Y;

    this.cacheKeybindingValues();
    this.init();
  }

  private cacheKeybindingValues(): void {
    if (!Array.isArray(this.settings.keyBindings)) {
      logger.error('Invalid keyBindings detected - using defaults');
      this.cachedSpeedStep = SPEED.STEP;
      this.cachedSeekValue = SEEK.DEFAULT_SECONDS;
      return;
    }

    const fasterBinding = this.settings.keyBindings.find((b) => b.action === 'faster');
    const advanceBinding = this.settings.keyBindings.find((b) => b.action === 'advance');
    this.cachedSpeedStep = fasterBinding?.value ?? SPEED.STEP;
    this.cachedSeekValue = advanceBinding?.value ?? SEEK.DEFAULT_SECONDS;
  }

  private init(): void {
    this.createController();

    this.media.addEventListener('ratechange', this.handleRateChange, { capture: true });
    this.media.addEventListener('play', this.handlePlay);

    if (this.media.playbackRate !== SPEED.DEFAULT) {
      this.updateSpeedDisplay();
    }

    this.startPositionCheck();
  }

  /**
   * Starts a periodic check to detect and repair positioning issues.
   * This handles cases where the parent loses positioning context or the
   * controller becomes orphaned due to dynamic DOM changes.
   */
  private startPositionCheck(): void {
    this.positionCheckInterval = setInterval(() => {
      this.verifyAndRepairPosition();
    }, VideoController.POSITION_CHECK_INTERVAL_MS);
  }

  /**
   * Checks if the controller is still properly positioned and repairs if needed.
   */
  private verifyAndRepairPosition(): void {
    if (!this.wrapper || !this.media.isConnected) return;

    // Repair 1: Controller became orphaned (removed from DOM)
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

    // Repair 2: Video moved to a different parent (common in SPAs)
    const expectedParent = this.siteHandler?.getControllerPosition(this.media as HTMLVideoElement)?.target
      ?? this.media.parentElement;
    if (parent !== expectedParent && expectedParent) {
      this.insertController();
      return;
    }

    // Repair 3: Parent lost positioning context
    // We use offsetParent to efficiently check if the parent is the current positioning context.
    // This handles cases where the parent is static but has a transform (which makes it a container).
    // Accessing offsetParent forces a layout, but so does getComputedStyle, and this check is more semantic.
    if (parent && parent !== document.body) {
      if (this.wrapper.offsetParent !== parent) {
        // Double check style before mutating to avoid fighting with some frameworks
        const style = getComputedStyle(parent);
        if (style.position === 'static' && style.transform === 'none') {
          parent.style.position = 'relative';
        } else if (this.wrapper.offsetParent !== parent) {
          // If parent supposedly has potential (transform!=none) but offsetParent is still wrong,
          // it might be because the browser doesn't consider it a container yet.
          // We fallback to re-inserting to force a refresh of the layout tree ties.
          this.insertController();
        }
      }
    }
  }

  /**
   * Constructs the Shadow DOM UI. Encapsulation prevents site styles from leaking in
   * and HARE styles from leaking out.
   */
  private createController(): void {
    this.wrapper = document.createElement(CONTROLLER.ELEMENT_TAG);
    this.wrapper.id = this.id;

    this.shadow = this.wrapper.attachShadow({ mode: 'open' });

    // Firefox content scripts may throw "Accessing from Xray wrapper" on adoptedStyleSheets
    try {
      this.shadow.adoptedStyleSheets = [getStyleSheet()];
    } catch {
      // Fallback: inject styles via <style> tag (Firefox compatibility)
      const styleEl = document.createElement('style');
      styleEl.textContent = controllerCSS;
      this.shadow.appendChild(styleEl);
    }

    this.controllerEl = document.createElement('div');
    this.controllerEl.className = 'hare-controller';
    if (this.isManuallyHidden) {
      this.controllerEl.classList.add('hidden');
    }

    this.controllerEl.style.setProperty('--hare-opacity', String(this.settings.controllerOpacity));
    this.controllerEl.style.setProperty('--hare-font-size', `${this.settings.controllerButtonSize}px`);
    this.wrapper.style.setProperty('--hare-z-index', String(CONTROLLER.Z_INDEX));

    this.speedDisplay = document.createElement('span');
    this.speedDisplay.className = 'hare-speed';
    this.speedDisplay.textContent = this.formatSpeed(this.media.playbackRate);
    this.speedDisplay.setAttribute('role', 'status');
    this.speedDisplay.setAttribute('aria-live', 'polite');
    this.speedDisplay.setAttribute('aria-label', 'Current playback speed');
    this.speedDisplay.setAttribute('tabindex', '0');

    if ('PointerEvent' in window) {
      this.speedDisplay.addEventListener('pointerdown', this.handleDragStart as EventListener);
    } else {
      this.speedDisplay.addEventListener('mousedown', this.handleDragStart as EventListener);
    }

    const controls = document.createElement('span');
    controls.className = 'hare-controls';

    const rewindBtn = this.createButton(ICONS.rewind, 'rewind', () => this.seek(-this.cachedSeekValue), 'Rewind');
    const slowerBtn = this.createButton(ICONS.slower, 'slower', () => this.adjustSpeed(-this.cachedSpeedStep), 'Slower');
    const fasterBtn = this.createButton(ICONS.faster, 'faster', () => this.adjustSpeed(this.cachedSpeedStep), 'Faster');
    const advanceBtn = this.createButton(ICONS.advance, 'advance', () => this.seek(this.cachedSeekValue), 'Advance');

    const hideBtn = this.createButton(ICONS.hide, 'hide', () => this.toggleVisibility(), 'Hide controller');
    hideBtn.classList.add('hare-btn-hide');
    hideBtn.setAttribute('aria-pressed', String(this.isManuallyHidden));
    this.hideBtn = hideBtn;

    controls.append(rewindBtn, slowerBtn, fasterBtn, advanceBtn, hideBtn);
    this.controllerEl.append(this.speedDisplay, controls);

    this.osdEl = document.createElement('div');
    this.osdEl.className = 'hare-osd';
    this.osdEl.textContent = '';

    this.shadow.appendChild(this.controllerEl);
    this.shadow.appendChild(this.osdEl);

    this.insertController();
    this.wrapper!.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  }

  /**
   * Safely creates an SVG element from a string using DOMParser.
   * Uses 'text/html' parsing to ensure the SVG and its children are created
   * in a way that renders correctly when inserted into Shadow DOM.
   */
  private createSVGFromString(svgString: string): SVGElement | null {
    const parser = new DOMParser();
    // Parsing as HTML ensures we get elements that work correctly in our DOM context
    const doc = parser.parseFromString(`<body>${svgString}</body>`, 'text/html');
    const svgElement = doc.body.querySelector('svg');

    if (svgElement) {
      // Import the node into current document to ensure it's properly adopted
      return document.importNode(svgElement, true) as SVGElement;
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

  /**
   * Ensures parent has a stacking context for absolute positioning.
   */
  private ensurePositioningContext(parent: HTMLElement): void {
    const style = getComputedStyle(parent);
    if (style.position === 'static') {
      parent.style.position = 'relative';
    }
  }

  /**
   * Mounts the controller into the DOM, preferring site-specific locations
   * defined in site handlers to avoid overlapping with native player UI.
   */
  private insertController(): void {
    if (!this.wrapper) return;

    let position: ControllerPosition | null = null;
    if (this.siteHandler) {
      position = this.siteHandler.getControllerPosition(this.media as HTMLVideoElement);
    }

    if (position) {
      const target = position.target as HTMLElement;

      // Validate target is still connected to DOM before mutation
      if (!target.isConnected) {
        // Site handler returned a stale reference - fallback to default positioning
        logger.debug('Site handler returned disconnected element, using fallback positioning');
        position = null;
      } else {
        this.ensurePositioningContext(target);

        switch (position.method) {
          case 'prepend': target.prepend(this.wrapper); break;
          case 'append': target.append(this.wrapper); break;
          case 'before': target.before(this.wrapper); break;
          case 'after': target.after(this.wrapper); break;
        }
      }
    }

    // Fallback to default positioning if no site-specific position or target was disconnected
    if (!position) {
      const parent = this.media.parentElement;
      if (parent) {
        this.ensurePositioningContext(parent);
        parent.prepend(this.wrapper);
      }
    }

    this.setupResizeObserver();
  }

  /**
   * Monitors parent container size to keep controller within visible bounds.
   * Uses debouncing to avoid layout thrashing during active resizing.
   */
  private setupResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Clear any pending debounce timeout from previous observer
    if (this.resizeDebounceTimeout) {
      clearTimeout(this.resizeDebounceTimeout);
      this.resizeDebounceTimeout = null;
    }

    const parent = this.wrapper?.parentElement;
    if (!parent) return;

    try {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.resizeDebounceTimeout) {
          clearTimeout(this.resizeDebounceTimeout);
        }
        this.resizeDebounceTimeout = setTimeout(() => {
          this.hasInitializedDragPosition = false;
          this.clampPosition();
          this.resizeDebounceTimeout = null;
        }, OBSERVER.DEBOUNCE_MS);
      });
      this.resizeObserver.observe(parent);
    } catch (error) {
      console.warn('[Hare] ResizeObserver failed:', error);
    }
  }

  /**
   * Calculates valid move boundaries, accounting for boundary padding.
   */
  private getClampedBounds(): { minX: number; maxX: number; minY: number; maxY: number } | null {
    if (!this.wrapper || !this.controllerEl) return null;

    const parent = this.wrapper.parentElement;
    if (!parent) return null;

    const parentRect = parent.getBoundingClientRect();
    let parentWidth = parentRect.width || parent.offsetWidth || window.innerWidth;
    let parentHeight = parentRect.height || parent.offsetHeight || window.innerHeight;

    // Site-specific containers often extend beyond the video; we clamp to the actual video element.
    const videoRect = this.media.getBoundingClientRect();
    if (videoRect.width > 0 && videoRect.height > 0) {
      parentWidth = Math.min(parentWidth, videoRect.width);
      parentHeight = Math.min(parentHeight, videoRect.height);
    }

    if (parentWidth === 0 || parentHeight === 0) return null;

    // Measure collapsed size for accurate boundary checks when controls are hidden.
    const controlsEl = this.controllerEl.querySelector('.hare-controls') as HTMLElement | null;
    if (controlsEl) controlsEl.style.display = 'none';

    const controllerRect = this.controllerEl.getBoundingClientRect();
    if (controlsEl) controlsEl.style.display = '';

    const padding = CONTROLLER.BOUNDARY_PADDING;

    return {
      minX: padding,
      maxX: Math.max(padding, parentWidth - controllerRect.width - padding),
      minY: padding,
      maxY: Math.max(padding, parentHeight - controllerRect.height - padding),
    };
  }

  private clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
  }

  private clampPosition(): void {
    if (!this.wrapper || this.isDragging) return;

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
    if (this.isEnforcingSpeed) {
      // Swallow the event so the website doesn't know the speed changed.
      // This prevents sites from running their own logic to reset the speed.
      e.stopImmediatePropagation();
    }
    this.updateSpeedDisplay();
    this.enforceSpeedIfNeeded();
  };

  private handlePlay = (): void => {
    if (!this.isManuallyHidden && this.controllerEl?.classList.contains('hidden')) {
      this.controllerEl.classList.remove('hidden');
    }
  };

  private handleDragStart = (e: MouseEvent | PointerEvent): void => {
    if (!this.wrapper) return;

    if (!this.media.isConnected) {
      this.destroy();
      return;
    }

    if (this.isDragging) return;

    e.preventDefault();
    e.stopPropagation();

    this.isDragging = true;
    this.controllerEl?.classList.add('dragging');

    if (!this.hasInitializedDragPosition) {
      const rect = this.wrapper.getBoundingClientRect();
      const parentRect = this.wrapper.parentElement?.getBoundingClientRect();
      if (parentRect) {
        this.positionX = rect.left - parentRect.left;
        this.positionY = rect.top - parentRect.top;
        this.hasInitializedDragPosition = true;
      }
    }

    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;

    this.dragOffsetX = clientX - this.wrapper.getBoundingClientRect().left;
    this.dragOffsetY = clientY - this.wrapper.getBoundingClientRect().top;

    this.cleanupDragListeners();

    if (e instanceof PointerEvent) {
      document.addEventListener('pointermove', this.handleDragMove);
      document.addEventListener('pointerup', this.handleDragEnd);
      document.addEventListener('pointercancel', this.handleDragEnd);
    } else {
      document.addEventListener('mousemove', this.handleDragMove);
      document.addEventListener('mouseup', this.handleDragEnd);
    }

    window.addEventListener('blur', this.handleDragEnd);
  };

  private handleDragMove = (e: MouseEvent | PointerEvent): void => {
    if (!this.isDragging || !this.wrapper) return;

    if (!this.media.isConnected) {
      this.handleDragEnd();
      return;
    }

    e.preventDefault();

    const parent = this.wrapper.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const bounds = this.getClampedBounds();
    if (!bounds) return;

    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;

    const newX = clientX - parentRect.left - this.dragOffsetX;
    const newY = clientY - parentRect.top - this.dragOffsetY;

    this.positionX = this.clampValue(newX, bounds.minX, bounds.maxX);
    this.positionY = this.clampValue(newY, bounds.minY, bounds.maxY);

    this.wrapper.style.transform = `translate(${this.positionX}px, ${this.positionY}px)`;
  };

  private handleDragEnd = (): void => {
    if (!this.isDragging) return;

    this.isDragging = false;
    this.controllerEl?.classList.remove('dragging');

    this.cleanupDragListeners();
  };

  private cleanupDragListeners(): void {
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    document.removeEventListener('pointermove', this.handleDragMove);
    document.removeEventListener('pointerup', this.handleDragEnd);
    document.removeEventListener('pointercancel', this.handleDragEnd);
    window.removeEventListener('blur', this.handleDragEnd);
  }

  private updateSpeedDisplay(): void {
    if (this.speedDisplay) {
      this.speedDisplay.textContent = this.formatSpeed(this.media.playbackRate);
    }
  }

  /**
   * Sets playback speed and verifies implementation. Some DRM/players may reject changes
   * or enforce limits; we notify the user via OSD if the actual speed differs from requested.
   */
  setSpeed(speed: number): void {
    const clampedSpeed = Math.max(SPEED.MIN, Math.min(SPEED.MAX, speed));
    const roundedSpeed = Math.round(clampedSpeed * 100) / 100;

    this.targetSpeed = roundedSpeed;
    this.isEnforcingSpeed = roundedSpeed !== SPEED.DEFAULT;
    const previousSpeed = this.media.playbackRate;
    this.media.playbackRate = roundedSpeed;

    requestAnimationFrame(() => {
      const actualSpeed = this.media.playbackRate;
      const tolerance = SPEED.TOLERANCE;

      if (Math.abs(actualSpeed - roundedSpeed) > tolerance) {
        if (Math.abs(actualSpeed - previousSpeed) < tolerance) {
          this.showOSD(MESSAGES.SPEED_CONTROL_BLOCKED);
        } else {
          this.showOSD(MESSAGES.SPEED_LIMITED(this.formatSpeed(actualSpeed)));
        }
      }
    });
  }

  adjustSpeed(delta: number): void {
    this.setSpeed(this.media.playbackRate + delta);
  }

  resetSpeed(): void {
    this.isEnforcingSpeed = false;
    this.targetSpeed = SPEED.DEFAULT;
    this.setSpeed(SPEED.DEFAULT);
  }

  /**
   * Reactively enforces the target speed when a ratechange event occurs.
   * Uses debouncing to prevent infinite loops if the site fights back.
   * This is triggered by ratechange events rather than polling to avoid
   * unnecessary writes that can cause side effects on sites like YouTube.
   */
  private enforceSpeedIfNeeded(): void {
    if (!this.isEnforcingSpeed) return;

    const now = Date.now();
    if (now - this.lastEnforcementTime < VideoController.ENFORCEMENT_DEBOUNCE_MS) {
      return; // Debounce to prevent loops
    }

    const tolerance = SPEED.TOLERANCE;
    if (Math.abs(this.media.playbackRate - this.targetSpeed) > tolerance) {
      try {
        this.lastEnforcementTime = now;
        this.media.playbackRate = this.targetSpeed;
      } catch (error) {
        // Some browsers/DRM systems may reject speed changes
        logger.debug('Speed enforcement failed (may be DRM-protected):', error);
        // Don't disable enforcement - retry on next ratechange
      }
    }
  }

  /**
   * Seeks the media by duration.
   */
  seek(seconds: number): void {
    if (this.media.readyState < SEEK.MIN_READY_STATE) return;

    try {
      this.media.currentTime += seconds;
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

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.cacheKeybindingValues();

    if (this.controllerEl) {
      this.controllerEl.style.setProperty('--hare-opacity', String(settings.controllerOpacity));
      this.controllerEl.style.setProperty('--hare-font-size', `${settings.controllerButtonSize}px`);
    }
  }

  get speed(): number {
    return this.media.playbackRate;
  }

  /**
   * Displays on-screen feedback for actions that don't have immediate visual state changes.
   */
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
    this.isEnforcingSpeed = false;

    this.media.removeEventListener('ratechange', this.handleRateChange, { capture: true });
    this.media.removeEventListener('play', this.handlePlay);

    if ('PointerEvent' in window) {
      this.speedDisplay?.removeEventListener('pointerdown', this.handleDragStart as EventListener);
    } else {
      this.speedDisplay?.removeEventListener('mousedown', this.handleDragStart as EventListener);
    }

    this.cleanupDragListeners();

    if (this.osdTimeout) clearTimeout(this.osdTimeout);
    if (this.resizeDebounceTimeout) clearTimeout(this.resizeDebounceTimeout);
    if (this.positionCheckInterval) clearInterval(this.positionCheckInterval);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.wrapper?.remove();
    this.wrapper = null;
    this.shadow = null;
    this.speedDisplay = null;
    this.controllerEl = null;
    this.osdEl = null;
  }
}
