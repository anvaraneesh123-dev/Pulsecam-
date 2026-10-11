/**
 * PulseCam - Wellness Suggestions & Breathing Coach Module
 * Provides contextual ergonomic guidance, the 20-20-20 rule timer,
 * and an interactive box-breathing pacer for heart-rate & stress regulation.
 */

export class SuggestionsManager {
  constructor() {
    this.sessionStartTime = Date.now();
    this.lastSuggestionTime = 0;
    this.activeExercise = null;
    this.breathingTimer = null;
  }

  /**
   * Evaluate metrics and generate prioritized wellness suggestions
   */
  getSuggestions(metrics) {
    const suggestions = [];
    const now = Date.now();
    const sessionDurationMinutes = (now - this.sessionStartTime) / 60000;

    // 1. Box Breathing recommendation for high stress or elevated HR
    if (metrics.stressState === 'Elevated' || metrics.fatigueScore > 50) {
      suggestions.push({
        id: 'box_breathing',
        category: 'Autonomic Tone',
        priority: 'high',
        iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
        title: 'Parasympathetic Reset (Box Protocol)',
        description:
          'Elevated heart rate trend indicates autonomic arousal. 2 minutes of 4-4-4-4 paced respiration lowers pulse frequency and stabilizes focus.',
        actionLabel: 'Initiate Protocol',
        actionType: 'BREATHING'
      });
    }

    // 2. 20-20-20 Rule for eye strain & infrequent blinking
    if (metrics.blinkRate < 10 || sessionDurationMinutes >= 20) {
      suggestions.push({
        id: 'rule_202020',
        category: 'Ocular Ergonomics',
        priority: 'high',
        iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
        title: '20-20-20 Ocular Relief Interval',
        description:
          'Infrequent blinking detected (< 10/min). Shift gaze to an object 20 feet (6m) away for 20 seconds to release ciliary muscle spasm.',
        actionLabel: 'Record 20s Pause',
        actionType: 'EYE_BREAK'
      });
    }

    // 3. Posture & Head Angle Alignment
    if (metrics.activeCues && metrics.activeCues.some((c) => c.type === 'head_droop')) {
      suggestions.push({
        id: 'posture',
        category: 'Cervical Alignment',
        priority: 'medium',
        iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="5" r="2"/><path d="M12 7v10"/><path d="M9 12h6"/><path d="M10 21l2-4 2 4"/></svg>`,
        title: 'Cervical Spine Angle Adjustment',
        description:
          'Forward head pitch detected. Elevate your display to direct eye line and roll shoulders back to eliminate neck strain.',
        actionLabel: 'Guidance',
        actionType: 'INFO'
      });
    }

    // 4. Ambient Hydration & Lighting Tips
    if (metrics.lightingLevel === 'too-dark' || metrics.lightingLevel === 'dim') {
      suggestions.push({
        id: 'lighting',
        category: 'Optics Environment',
        priority: 'medium',
        iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><circle cx="12" cy="12" r="5"/></svg>`,
        title: 'Calibrate Frontal Illumination',
        description:
          'Subdued ambient light forces pupil dilation and increases optical noise. Introduce soft frontal illumination.',
        actionLabel: 'Acknowledge',
        actionType: 'INFO'
      });
    }

    // Baseline fallback suggestion
    if (suggestions.length === 0) {
      suggestions.push({
        id: 'hydration',
        category: 'Sustained Focus',
        priority: 'low',
        iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
        title: 'Hydration & Microcirculation',
        description:
          'Heart rate and ocular frequency remain stable. Drink water to support capillary blood volume stability.',
        actionLabel: 'Dismiss',
        actionType: 'DISMISS'
      });
    }

    return suggestions;
  }

  /**
   * Start 4-4-4-4 Box Breathing visual cycle in specified container
   */
  startBreathingExercise(containerElement, onPhaseChange = null) {
    if (!containerElement) return;

    let phaseIndex = 0;
    const phases = [
      { name: 'Inhale slowly...', duration: 4, action: 'expand' },
      { name: 'Hold gently...', duration: 4, action: 'hold' },
      { name: 'Exhale smoothly...', duration: 4, action: 'contract' },
      { name: 'Hold empty...', duration: 4, action: 'hold-empty' }
    ];

    let countdown = phases[0].duration;

    const render = () => {
      const current = phases[phaseIndex];
      containerElement.innerHTML = `
        <div class="breathing-coach-box">
          <div class="breathing-geometric-circle ${current.action}">
            <span class="breathing-count-num">${countdown}</span>
          </div>
          <h3 class="breathing-phase-label">${current.name}</h3>
          <p class="breathing-subtext">Rhythmic Box Protocol (4-4-4-4) • Autonomic Regulation</p>
          <button id="btn-close-breathing" class="btn btn-secondary btn-sm" style="margin-top: 1.2rem;">End Protocol</button>
        </div>
      `;

      const btnClose = document.getElementById('btn-close-breathing');
      if (btnClose) {
        btnClose.onclick = () => this.stopBreathingExercise(containerElement);
      }

      if (onPhaseChange) onPhaseChange(current.name, countdown);
    };

    render();

    this.breathingTimer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        phaseIndex = (phaseIndex + 1) % phases.length;
        countdown = phases[phaseIndex].duration;
      }
      render();
    }, 1000);
  }

  stopBreathingExercise(containerElement) {
    if (this.breathingTimer) {
      clearInterval(this.breathingTimer);
      this.breathingTimer = null;
    }
    if (containerElement) {
      containerElement.innerHTML = '';
    }
  }
}
