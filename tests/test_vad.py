import pytest

from backend.pipeline.vad import VADBuffer

from .conftest import silence_pcm, sine_pcm, speech_like_pcm


def test_pure_silence_yields_nothing():
    buf = VADBuffer(sample_rate=16000, silence_ms=700)
    out = buf.ingest(silence_pcm(2000))
    assert out is None


def test_speech_then_long_silence_yields_utterance():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)  # shorter for test speed
    # 1s of speech-like synthetic voiced signal then 800ms of silence
    out = buf.ingest(speech_like_pcm(1000) + silence_pcm(800))
    assert out is not None
    assert isinstance(out, bytes)
    assert len(out) > 0


def test_speech_without_trailing_silence_does_not_yield():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)
    out = buf.ingest(speech_like_pcm(1000))
    assert out is None


def test_buffer_resets_after_utterance():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)
    _ = buf.ingest(speech_like_pcm(1000) + silence_pcm(800))
    # Now feed another speech+silence and confirm we get a second utterance
    out2 = buf.ingest(speech_like_pcm(1000, seed=2) + silence_pcm(800))
    assert out2 is not None
