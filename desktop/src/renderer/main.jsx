// app.jsx — Daisy Helps prototype
// Wires the screens together with a simulated state machine that mirrors the
// real WebSocket lifecycle from the handoff (idle → listening → thinking → speaking → idle).

const { useState, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "screen": "welcome",
  "state": "idle",
  "language": "en",
  "fontScale": 1.0,
  "backendStubbed": false,
  "micDenied": false,
  "showConsent": false,
  "autoDemo": true,
  "mkScale": 4.0,
  "mkOffsetX": -40,
  "mkOffsetY": -52,
  "mkOriginX": 22.5,
  "mkOriginY": 25.5,
  "mkCenterX": -40,
  "mkCenterY": -52,
  "logoSize": 298,
  "logoOffsetY": -92,
  "helpOffsetY": -78,
  "helpOffsetX": -62
}/*EDITMODE-END*/;

// ─────────────────────────────────────────────────────────────
// Simulated server replies (we mirror the WS contract verbatim
// but the bytes come from a local timer instead of FastAPI).
// ─────────────────────────────────────────────────────────────
function useSimulatedDaisy({ lang, state, setState, setUserText, setDaisyText, setDaisyStreaming, autoplay }) {
  const t = COPY[lang];
  const timeoutsRef = useRef([]);
  const clear = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; };

  useEffect(() => () => clear(), []);

  // Stream a string word-by-word into the caption, then flip to idle.
  const streamSpeak = useCallback((fullText) => {
    setDaisyText('');
    setDaisyStreaming(true);
    setState('speaking');
    const words = fullText.split(/(\s+)/); // keep whitespace tokens
    let i = 0;
    const tick = () => {
      i++;
      setDaisyText(words.slice(0, i).join(''));
      if (i < words.length) {
        const id = setTimeout(tick, 70 + Math.random() * 60);
        timeoutsRef.current.push(id);
      } else {
        setDaisyStreaming(false);
        const id = setTimeout(() => setState('idle'), 1100);
        timeoutsRef.current.push(id);
      }
    };
    timeoutsRef.current.push(setTimeout(tick, 250));
  }, [setDaisyText, setDaisyStreaming, setState]);

  // Listening → thinking → speaking
  const runTurn = useCallback((utterance, reply) => {
    clear();
    setState('listening');
    setUserText('');
    timeoutsRef.current.push(setTimeout(() => {
      setUserText(utterance);
      setState('thinking');
      timeoutsRef.current.push(setTimeout(() => streamSpeak(reply), 1300));
    }, 2400));
  }, [setState, setUserText, streamSpeak]);

  // Cancel everything (matches `interrupt` from contract)
  const stopAll = useCallback(() => { clear(); setDaisyStreaming(false); setState('idle'); }, [setState, setDaisyStreaming]);

  // Auto-run a single sample turn on first visit to the conversation screen.
  useEffect(() => {
    if (!autoplay) return;
    // First, Daisy speaks her greeting after a beat.
    const id = setTimeout(() => streamSpeak(t.sampleDaisy), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, lang]);

  return { runTurn, stopAll, streamSpeak };
}

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const lang = t.language;
  const screen = t.screen;
  const state = t.state;

  // Auto-open the Tweaks panel when running locally (no parent frame to send the message)
  useEffect(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: '__activate_edit_mode' } }));
  }, []);

  // Apply font scale at the root
  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(t.fontScale));
  }, [t.fontScale]);

  // Sync logo size + position to CSS custom properties
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--logo-size', t.logoSize + 'px');
    r.setProperty('--logo-offset-y', t.logoOffsetY + 'px');
    r.setProperty('--help-offset-y', t.helpOffsetY + 'px');
    r.setProperty('--help-offset-x', t.helpOffsetX + 'px');
  }, [t.logoSize, t.logoOffsetY, t.helpOffsetY, t.helpOffsetX]);

  // Sync flower positioning to CSS custom properties so DaisyMark picks them up
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--mk-scale', t.mkScale);
    r.setProperty('--mk-x', t.mkOffsetX + '%');
    r.setProperty('--mk-y', t.mkOffsetY + '%');
    r.setProperty('--mk-ox', t.mkOriginX + '%');
    r.setProperty('--mk-oy', t.mkOriginY + '%');
    r.setProperty('--mk-cx', t.mkCenterX + '%');
    r.setProperty('--mk-cy', t.mkCenterY + '%');
  }, [t.mkScale, t.mkOffsetX, t.mkOffsetY, t.mkOriginX, t.mkOriginY, t.mkCenterX, t.mkCenterY]);

  // Local conversation state (transcript + captions)
  const [userText, setUserText] = useState('');
  const [daisyText, setDaisyText] = useState('');
  const [daisyStreaming, setDaisyStreaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setState = (s) => setTweak('state', s);

  const sim = useSimulatedDaisy({
    lang,
    state,
    setState,
    setUserText,
    setDaisyText,
    setDaisyStreaming,
    autoplay: screen === 'conversation' && t.autoDemo && state === 'idle' && daisyText === '',
  });

  // When the user changes language during a session, sim resets via key.
  useEffect(() => {
    setDaisyText('');
    setUserText('');
  }, [lang]);

  // Handlers
  const startSession = () => {
    setTweak({ screen: 'conversation', state: 'idle' });
    setDaisyText(''); setUserText('');
  };
  const onTalk = () => sim.runTurn(COPY[lang].sampleUser, COPY[lang].sampleSpeaking);
  const onStopTalk = () => { /* matches: send end-of-utterance marker */
    setState('thinking');
    setTimeout(() => sim.streamSpeak(COPY[lang].sampleSpeaking), 1200);
  };
  const onStopDaisy = () => sim.stopAll();

  const endSession = () => {
    sim.stopAll();
    setSettingsOpen(false);
    setTweak({ screen: 'goodbye', state: 'idle' });
  };
  const startOver = () => {
    setDaisyText(''); setUserText('');
    setTweak({ screen: 'welcome', state: 'idle' });
  };

  const onConsentYes = () => setTweak('showConsent', false);
  const onConsentNo = () => setTweak('showConsent', false);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="shell">
        {(screen === 'welcome' || screen === 'conversation' || screen === 'goodbye') && (
          <TopBar
            lang={lang}
            onLang={(l) => setTweak('language', l)}
            onSettings={() => setSettingsOpen((v) => !v)}
            showSettings={screen === 'conversation'}
          />
        )}

        {screen === 'welcome' && (
          <WelcomeScreen lang={lang} onStart={startSession} />
        )}

        {screen === 'conversation' && (
          <>
            <ConversationScreen
              lang={lang}
              state={state}
              userTranscript={userText}
              daisyText={daisyText}
              daisyStreaming={daisyStreaming}
              backendStubbed={t.backendStubbed}
              micDenied={t.micDenied}
              onTextFallback={() => {}}
            />
            <ActionBar
              lang={lang}
              state={state}
              onTalk={onTalk}
              onStopTalk={onStopTalk}
              onStopDaisy={onStopDaisy}
            />
          </>
        )}

        {screen === 'goodbye' && (
          <GoodbyeScreen lang={lang} onAgain={startOver} />
        )}

        {/* a tiny footer mark on welcome */}
        {screen === 'welcome' && (
          <div style={{ textAlign: 'center', color: 'var(--ink-2)', fontSize: '0.9rem', paddingBottom: 8 }}>
            {COPY[lang].tagline}
          </div>
        )}
      </div>

      {t.showConsent && screen === 'conversation' && (
        <ScreenshotConsent
          lang={lang}
          reason={lang === 'en'
            ? 'I\u2019d like to see what\u2019s on your screen so I can point to the right button.'
            : 'Quisiera ver lo que est\u00e1 en tu pantalla para indicarte el bot\u00f3n correcto.'}
          onYes={onConsentYes}
          onNo={onConsentNo}
        />
      )}

      {settingsOpen && screen === 'conversation' && (
        <SettingsSheet
          lang={lang}
          fontScale={t.fontScale}
          onFontScale={(v) => setTweak('fontScale', v)}
          onClose={() => setSettingsOpen(false)}
          onEnd={endSession}
          onAudioTest={() => {/* play a friendly beep in real build */}}
        />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Demo" />
        <TweakRadio label="Screen" value={screen}
          options={['welcome', 'conversation', 'goodbye']}
          onChange={(v) => setTweak('screen', v)} />
        <TweakSelect label="Daisy state" value={state}
          options={['idle', 'listening', 'thinking', 'speaking']}
          onChange={(v) => {
            // When jumping into a state manually, give the captions some content.
            const c = COPY[lang];
            if (v === 'listening') { setUserText(''); setDaisyText(c.sampleDaisy); setDaisyStreaming(false); }
            if (v === 'thinking')  { setUserText(c.sampleUser); setDaisyText(c.sampleDaisy); setDaisyStreaming(false); }
            if (v === 'speaking')  { setUserText(c.sampleUser); setDaisyText(c.sampleSpeaking); setDaisyStreaming(true); }
            if (v === 'idle')      { /* leave as is */ }
            setTweak({ state: v, screen: 'conversation', autoDemo: false });
          }} />
        <TweakButton label="Run sample turn" onClick={() => { setTweak({ screen: 'conversation', autoDemo: false }); onTalk(); }} />
        <TweakToggle label="Auto-demo greeting" value={t.autoDemo}
          onChange={(v) => setTweak('autoDemo', v)} />

        <TweakSection label="Language" />
        <TweakRadio label="Language" value={lang}
          options={['en', 'es']}
          onChange={(v) => setTweak('language', v)} />

        <TweakSection label="Accessibility" />
        <TweakSlider label="Font scale" value={t.fontScale} min={0.85} max={1.6} step={0.05} unit="x"
          onChange={(v) => setTweak('fontScale', +v.toFixed(2))} />
        <TweakSlider label="Logo size" value={t.logoSize} min={40} max={400} step={2} unit="px"
          onChange={(v) => setTweak('logoSize', v)} />
        <TweakSlider label="Logo offset Y" value={t.logoOffsetY} min={-200} max={100} step={1} unit="px"
          onChange={(v) => setTweak('logoOffsetY', v)} />
        <TweakSlider label="Helps offset Y" value={t.helpOffsetY} min={-200} max={100} step={1} unit="px"
          onChange={(v) => setTweak('helpOffsetY', v)} />
        <TweakSlider label="Helps offset X" value={t.helpOffsetX} min={-200} max={200} step={1} unit="px"
          onChange={(v) => setTweak('helpOffsetX', v)} />

        <TweakSection label="Flower position" />
        <TweakSlider label="Scale" value={t.mkScale} min={1} max={10} step={0.1} unit="×"
          onChange={(v) => setTweak('mkScale', +v.toFixed(1))} />
        <TweakSlider label="Offset X" value={t.mkOffsetX} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkOffsetX', v)} />
        <TweakSlider label="Offset Y" value={t.mkOffsetY} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkOffsetY', v)} />
        <TweakSlider label="Origin X" value={t.mkOriginX} min={0} max={100} step={0.5} unit="%"
          onChange={(v) => setTweak('mkOriginX', +v.toFixed(1))} />
        <TweakSlider label="Origin Y" value={t.mkOriginY} min={0} max={100} step={0.5} unit="%"
          onChange={(v) => setTweak('mkOriginY', +v.toFixed(1))} />

        <TweakSection label="Center position" />
        <TweakSlider label="Center X" value={t.mkCenterX} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkCenterX', v)} />
        <TweakSlider label="Center Y" value={t.mkCenterY} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkCenterY', v)} />

        <TweakSection label="Edge cases" />
        <TweakToggle label="Backend partly stubbed" value={t.backendStubbed}
          onChange={(v) => setTweak('backendStubbed', v)} />
        <TweakToggle label="Microphone denied" value={t.micDenied}
          onChange={(v) => setTweak('micDenied', v)} />
        <TweakButton label="Show screenshot consent" onClick={() => setTweak({ screen: 'conversation', showConsent: true })} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
