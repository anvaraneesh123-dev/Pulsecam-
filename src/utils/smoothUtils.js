/**
 * PulseCam - Delta-Time Smooth Interpolation Utilities
 * Supports framerate-independent exponential smoothing and critically damped springs
 * for smooth visual gliding across 60 Hz, 120 Hz, and 144+ Hz displays.
 */

/**
 * Exponential Smoother with Delta Time
 * x(t + dt) = target + (x(t) - target) * exp(-lambda * dt)
 */
export class SmoothValue {
  constructor(initial = 0, lambda = 8) {
    this.current = initial;
    this.target = initial;
    this.lambda = lambda; // Speed of convergence (higher = faster)
  }

  setTarget(target) {
    if (target !== null && target !== undefined && !isNaN(target)) {
      this.target = target;
    }
  }

  reset(val = 0) {
    this.current = val;
    this.target = val;
  }

  update(dt) {
    if (this.target === null || isNaN(this.target)) return this.current;
    // Framerate-independent exponential decay toward target
    const decay = Math.exp(-this.lambda * dt);
    this.current = this.target + (this.current - this.target) * decay;
    return this.current;
  }
}

/**
 * Critically Damped Spring Damper
 * Reaches target with zero oscillation or overshoot
 */
export class SpringDamper {
  constructor(initial = 0, frequency = 6) {
    this.current = initial;
    this.velocity = 0;
    this.target = initial;
    this.omega = frequency * 2 * Math.PI; // Angular frequency
  }

  setTarget(target) {
    if (target !== null && target !== undefined && !isNaN(target)) {
      this.target = target;
    }
  }

  reset(val = 0) {
    this.current = val;
    this.velocity = 0;
    this.target = val;
  }

  update(dt) {
    if (this.target === null || isNaN(this.target)) return this.current;
    // Analytic solution for critically damped spring
    const omega = this.omega;
    const delta = this.current - this.target;
    const expTerm = Math.exp(-omega * dt);

    const c1 = delta;
    const c2 = this.velocity + omega * delta;

    this.current = this.target + (c1 + c2 * dt) * expTerm;
    this.velocity = (this.velocity - omega * c2 * dt) * expTerm;

    return this.current;
  }
}
