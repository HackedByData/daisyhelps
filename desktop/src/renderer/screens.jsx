// screens.jsx — All screen surfaces for Daisy Helps

// ─────────────────────────────────────────────────────────────
// Copy in EN/ES — every word the user sees is keyed by language.
// ─────────────────────────────────────────────────────────────
const COPY = {
  en: {
    tagline: 'Patient help for your computer',
    welcomeTitle: 'Hello. I\u2019m Daisy.',
    welcomeLede: 'I help you do things on your computer, one calm step at a time. Just talk to me out loud.',
    start: 'Start talking to Daisy',
    micExplain: 'I\u2019ll ask to use your microphone so I can hear you.',
    youSaid: 'You said',
    daisy: 'Daisy',
    daisySays: 'Daisy is saying',
    statusIdle: 'Tap the big button when you\u2019re ready',
    statusIdleHero: 'I\u2019m here when you\u2019re ready.',
    statusListening: 'I\u2019m listening\u2026',
    statusListeningHero: 'Go ahead, I\u2019m listening.',
    statusThinking: 'Daisy is thinking\u2026',
    statusThinkingHero: 'Just a moment, I\u2019m thinking\u2026',
    statusSpeaking: 'Daisy is speaking',
    statusSpeakingHero: 'Listen — I\u2019m here.',
    talk: 'Start talking',
    stopTalking: 'I\u2019m done talking',
    stopDaisy: 'Stop Daisy',
    settings: 'Settings',
    settingsTitle: 'Settings',
    textSize: 'Text size',
    audioTest: 'Test the sound',
    end: 'End the visit',
    close: 'Close',
    consentTitle: 'May I see your screen?',
    consentWhy: 'Your screen is only sent to Daisy for this one moment. It is not saved.',
    consentYes: 'Show Daisy my screen',
    consentNo: 'Not right now',
    goodbye: 'Thanks for visiting with Daisy.',
    goodbyeSub: 'Come back any time. I\u2019m always happy to help.',
    again: 'Start a new visit',
    errMicTitle: 'I can\u2019t hear you yet.',
    errMicBody: 'Your microphone is turned off. You can still type to me instead.',
    typeInstead: 'Type to Daisy',
    errWsTitle: 'I lost the connection for a moment.',
    errWsBody: 'I\u2019m trying again. This usually fixes itself in a few seconds.',
    retry: 'Try again now',
    errTtsTitle: 'My voice is having a hiccup.',
    errTtsBody: 'You can still read my words on the screen while I sort it out.',
    stubBanner: 'A few helpers are still warming up. You can still chat.',
    sampleDaisy: 'I\u2019ll help you join your Zoom call with your doctor. First, let\u2019s find the email from her office. Can you tell me what you see on your screen right now?',
    sampleUser: 'I see a lot of icons. There\u2019s one that says mail.',
    sampleSpeaking: 'Wonderful. Go ahead and click on the one that says Mail. Take your time \u2014 I\u2019ll wait.',
  },
  es: {
    tagline: 'Ayuda paciente para tu computadora',
    welcomeTitle: 'Hola. Soy Daisy.',
    welcomeLede: 'Te ayudo a hacer cosas en tu computadora, un paso a la vez. Solo h\u00e1blame en voz alta.',
    start: 'Empezar a hablar con Daisy',
    micExplain: 'Te voy a pedir permiso para usar el micr\u00f3fono y poder escucharte.',
    youSaid: 'Dijiste',
    daisy: 'Daisy',
    daisySays: 'Daisy est\u00e1 hablando',
    statusIdle: 'Toca el bot\u00f3n grande cuando est\u00e9s lista',
    statusIdleHero: 'Aqu\u00ed estoy cuando est\u00e9s lista.',
    statusListening: 'Te estoy escuchando\u2026',
    statusListeningHero: 'Adelante, te escucho.',
    statusThinking: 'Daisy est\u00e1 pensando\u2026',
    statusThinkingHero: 'Un momento, estoy pensando\u2026',
    statusSpeaking: 'Daisy est\u00e1 hablando',
    statusSpeakingHero: 'Escucha \u2014 estoy aqu\u00ed.',
    talk: 'Empezar a hablar',
    stopTalking: 'Termin\u00e9 de hablar',
    stopDaisy: 'Detener a Daisy',
    settings: 'Ajustes',
    settingsTitle: 'Ajustes',
    textSize: 'Tama\u00f1o del texto',
    audioTest: 'Probar el sonido',
    end: 'Terminar la visita',
    close: 'Cerrar',
    consentTitle: '\u00bfPuedo ver tu pantalla?',
    consentWhy: 'Tu pantalla se env\u00eda a Daisy solo por un momento. No se guarda.',
    consentYes: 'Mostrar mi pantalla',
    consentNo: 'Ahora no',
    goodbye: 'Gracias por visitar a Daisy.',
    goodbyeSub: 'Vuelve cuando quieras. Siempre me alegra ayudarte.',
    again: 'Empezar una nueva visita',
    errMicTitle: 'Todav\u00eda no te escucho.',
    errMicBody: 'Tu micr\u00f3fono est\u00e1 apagado. Puedes escribirme en su lugar.',
    typeInstead: 'Escribirle a Daisy',
    errWsTitle: 'Perd\u00ed la conexi\u00f3n por un momento.',
    errWsBody: 'Estoy intentando otra vez. Esto suele arreglarse en unos segundos.',
    retry: 'Intentar de nuevo',
    errTtsTitle: 'Mi voz tiene un peque\u00f1o problema.',
    errTtsBody: 'Puedes leer mis palabras en la pantalla mientras lo arreglo.',
    stubBanner: 'Algunos ayudantes todav\u00eda se est\u00e1n calentando. Puedes seguir hablando.',
    sampleDaisy: 'Te voy a ayudar a entrar a tu llamada de Zoom con tu doctora. Primero, busquemos el correo de su oficina. \u00bfMe puedes decir qu\u00e9 ves en tu pantalla?',
    sampleUser: 'Veo muchos iconos. Hay uno que dice correo.',
    sampleSpeaking: 'Perfecto. Haz clic en el que dice Correo. Tomate tu tiempo \u2014 yo te espero.',
  },
};

// ─────────────────────────────────────────────────────────────
// Top bar (brand + language toggle + settings)
// ─────────────────────────────────────────────────────────────
function TopBar({ lang, onLang, onSettings, showSettings = true }) {
  const t = COPY[lang];
  return (
    <header className="topbar" role="banner">
      <div className="topbar__brand">
        <img src="assets/daisy_logo__1_-removebg-preview.png" alt="Daisy" />
        <span className="tag">helps</span>
      </div>
      <div className="topbar__right">
        <div className="lang" role="group" aria-label="Language / Idioma">
          <button aria-pressed={lang === 'en'} onClick={() => onLang('en')}>English</button>
          <button aria-pressed={lang === 'es'} onClick={() => onLang('es')}>Espa&ntilde;ol</button>
        </div>
        {showSettings && (
          <button className="icon-btn" aria-label={t.settings} onClick={onSettings}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Welcome screen
// ─────────────────────────────────────────────────────────────
function WelcomeScreen({ lang, onStart }) {
  const t = COPY[lang];
  return (
    <main className="welcome" role="main">
      <div>
        <h1>{t.welcomeTitle}</h1>
        <p className="lede">{t.welcomeLede}</p>
        <button className="btn btn--primary btn--xl" onClick={onStart}>
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
          {t.start}
        </button>
        <div className="perm-note">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v5" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
          </svg>
          {t.micExplain}
        </div>
      </div>
      <DaisyMark state="idle" pos={{ scale: 5.2, offsetX: -121, offsetY: -200, originX: 13, originY: 25.5, center: { x: -121, y: -200 } }} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// Conversation screen — driven by `state`
// ─────────────────────────────────────────────────────────────
function ConversationScreen({
  lang, state,
  markState,                // visual-only; can be 'returning' for petal-float-home transition
  userTranscript,
  daisyText,
  daisyStreaming,
  onTalk, onStopTalk, onStopDaisy, onTextFallback,
  backendStubbed,
  micDenied,
  micMessage,
  clickHint,                // label of UI element Daisy is asking the user to click
}) {
  const visualState = markState || state;
  const t = COPY[lang];
  const heroLabel = {
    idle: t.statusIdle, listening: t.statusListening,
    thinking: t.statusThinking, speaking: t.statusSpeaking,
  }[state];
  const heroStatus = {
    idle: t.statusIdleHero, listening: t.statusListeningHero,
    thinking: t.statusThinkingHero, speaking: t.statusSpeakingHero,
  }[state];

  return (
    <main className="stage" role="main">
      {/* HERO (Daisy presence + state) */}
      <section className="hero" aria-live="polite" aria-atomic="false">
        <div className="hero__label">{heroLabel}</div>
        <DaisyMark state={visualState} pos={{ scale: 2.8, offsetX: -68, offsetY: -80, originX: 13, originY: 25.5, center: { idle: { x: -67, y: -80 }, listening: { x: -62, y: -77 }, thinking: { x: -67, y: -80 }, speaking: { x: -67, y: -80 }, returning: { x: -67, y: -80 } } }} />
        <div className="hero__status">{heroStatus}</div>
        {state === 'listening' && (
          <div style={{ color: 'var(--daisy-green-deep)' }}>
            <span className="mic-bars" aria-hidden="true">
              <span /><span /><span /><span /><span />
            </span>
          </div>
        )}
      </section>

      {/* CAPTIONS + last user utterance */}
      <section className="caption-wrap">
        {backendStubbed && (
          <div className="banner" role="status">
            <span className="banner__icon" aria-hidden="true">!</span>
            <div>{t.stubBanner}</div>
          </div>
        )}
        {micDenied && (
          <div className="banner banner--alert" role="status">
            <span className="banner__icon" aria-hidden="true">!</span>
            <div><strong>{t.errMicTitle}</strong> {micMessage || t.errMicBody}</div>
          </div>
        )}
        {clickHint && (
          <div className="banner" role="status" style={{ background: 'var(--daisy-yellow)', color: 'var(--ink-0)' }}>
            <span className="banner__icon" aria-hidden="true">👉</span>
            <div>
              {lang === 'en'
                ? <>Click on <strong>{clickHint}</strong>, then tell me what happened.</>
                : <>Haz clic en <strong>{clickHint}</strong>, luego dime qué pasó.</>}
            </div>
          </div>
        )}

        <div className="caption" aria-live="polite" aria-atomic="false" aria-label={t.daisySays}>
          <div className="caption__who">{t.daisy}</div>
          <div className="caption__text">
            {daisyText || (state === 'idle' ? '\u2014' : '\u2026')}
            {state === 'speaking' && daisyStreaming && <span className="cursor" aria-hidden="true" />}
          </div>
        </div>

        {userTranscript && (
          <div className="you-said">
            <div className="you-said__label">{t.youSaid}</div>
            <div className="you-said__text">&ldquo;{userTranscript}&rdquo;</div>
          </div>
        )}
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// Bottom action bar — primary action adapts to state
// ─────────────────────────────────────────────────────────────
function ActionBar({ lang, state, onTalk, onStopTalk, onStopDaisy }) {
  const t = COPY[lang];
  let primary = null;
  if (state === 'idle')
    primary = <button className="btn btn--primary btn--xl" onClick={onTalk}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
      </svg>
      {t.talk}
    </button>;
  else if (state === 'listening')
    primary = <button className="btn btn--go btn--xl" onClick={onStopTalk}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
      {t.stopTalking}
    </button>;
  else if (state === 'thinking')
    primary = <button className="btn btn--quiet btn--xl" disabled aria-disabled="true">
      {t.statusThinking}
    </button>;
  else if (state === 'speaking')
    primary = <button className="btn btn--stop btn--xl" onClick={onStopDaisy}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
      {t.stopDaisy}
    </button>;

  return (
    <footer className="actions" role="contentinfo">
      <div className="actions__secondary">
        <div className="status-dot" data-state={state} aria-hidden="true">
          {{ idle: t.statusIdle, listening: t.statusListening, thinking: t.statusThinking, speaking: t.statusSpeaking }[state]}
        </div>
      </div>
      <div className="actions__primary">{primary}</div>
      <div className="actions__secondary" aria-hidden="true" style={{ visibility: 'hidden' }}>
        <div className="status-dot">spacer</div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────
// Screenshot consent modal
// ─────────────────────────────────────────────────────────────
function ScreenshotConsent({ lang, reason, onYes, onNo }) {
  const t = COPY[lang];
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal">
        <h2 id="consent-title">{t.consentTitle}</h2>
        <div className="modal__reason">
          <strong style={{ fontFamily: 'Fraunces, serif', fontWeight: 600 }}>{lang === 'en' ? 'Daisy says: ' : 'Daisy dice: '}</strong>
          &ldquo;{reason}&rdquo;
        </div>
        <div className="modal__why">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: 'none', color: 'var(--ink-2)' }}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{t.consentWhy}</span>
        </div>
        <div className="modal__actions">
          <button ref={ref} className="btn btn--primary btn--xl" onClick={onYes} style={{ flex: 1 }}>{t.consentYes}</button>
          <button className="btn btn--ghost btn--xl" onClick={onNo} style={{ flex: 1 }}>{t.consentNo}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings sheet
// ─────────────────────────────────────────────────────────────
function SettingsSheet({ lang, fontScale, onFontScale, onClose, onEnd, onAudioTest }) {
  const t = COPY[lang];
  return (
    <aside className="sheet" role="dialog" aria-modal="false" aria-labelledby="settings-title">
      <h3 id="settings-title">{t.settingsTitle}</h3>
      <div className="sheet__row">
        <div className="sheet__label">{t.textSize}</div>
        <div className="sheet__steppers">
          <button className="stepper" aria-label="Smaller" onClick={() => onFontScale(Math.max(0.85, +(fontScale - 0.1).toFixed(2)))}>A&minus;</button>
          <button className="stepper" aria-label="Larger" onClick={() => onFontScale(Math.min(1.6, +(fontScale + 0.1).toFixed(2)))}>A+</button>
        </div>
      </div>
      <div className="sheet__row">
        <div className="sheet__label">{t.audioTest}</div>
        <button className="btn btn--quiet" onClick={onAudioTest} style={{ minHeight: 56 }}>
          {lang === 'en' ? 'Play sound' : 'Reproducir'}
        </button>
      </div>
      <div className="sheet__row">
        <div className="sheet__label">{t.end}</div>
        <button className="btn btn--danger" onClick={onEnd} style={{ minHeight: 56 }}>
          {lang === 'en' ? 'End now' : 'Terminar'}
        </button>
      </div>
      <div className="sheet__row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={onClose} style={{ minHeight: 56 }}>{t.close}</button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Goodbye / end-of-session
// ─────────────────────────────────────────────────────────────
function GoodbyeScreen({ lang, onAgain }) {
  const t = COPY[lang];
  return (
    <main className="goodbye" role="main">
      <DaisyMark state="idle" pos={{ scale: 2.8, offsetX: -1, offsetY: -78, originX: 13, originY: 25.5, center: { x: -1, y: -78 } }} />
      <h1 style={{ marginTop: 28 }}>{t.goodbye}</h1>
      <p>{t.goodbyeSub}</p>
      <button className="btn btn--primary btn--xl" onClick={onAgain}>{t.again}</button>
    </main>
  );
}

Object.assign(window, { COPY, TopBar, WelcomeScreen, ConversationScreen, ActionBar, ScreenshotConsent, SettingsSheet, GoodbyeScreen });
