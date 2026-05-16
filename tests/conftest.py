"""Shared pytest fixtures and PCM helpers."""
import math
import struct

import numpy as np


SAMPLE_RATE = 16000


def silence_pcm(duration_ms: int) -> bytes:
    """Return `duration_ms` of silence as 16-bit LE PCM bytes at 16kHz mono."""
    n = int(SAMPLE_RATE * duration_ms / 1000)
    return struct.pack(f"<{n}h", *([0] * n))


def sine_pcm(duration_ms: int, freq_hz: float = 440.0, amplitude: float = 0.6) -> bytes:
    """Return `duration_ms` of a sine wave as 16-bit LE PCM bytes at 16kHz mono."""
    n = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(n) / SAMPLE_RATE
    samples = (amplitude * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    return samples.tobytes()


def noise_pcm(duration_ms: int, amplitude: float = 0.5) -> bytes:
    """Pseudo-speech via random noise; more likely to trip Silero than pure sine."""
    n = int(SAMPLE_RATE * duration_ms / 1000)
    rng = np.random.default_rng(seed=42)
    samples = (rng.standard_normal(n).clip(-1.0, 1.0) * amplitude * 32767).astype(np.int16)
    return samples.tobytes()


def speech_like_pcm(duration_ms: int, seed: int = 1, amplitude: float = 0.6) -> bytes:
    """Synthetic voiced signal with time-varying formants, jittered fundamental,
    and syllable-rate spectral motion. Designed to register as speech in
    silero-vad, which pure sine waves and white noise do not reliably trigger.
    Returns 16-bit LE PCM bytes at 16kHz mono.
    """
    rng = np.random.default_rng(seed)
    n = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(n) / SAMPLE_RATE
    # Time-varying fundamental around 130 Hz with slow drift and 3 Hz vibrato.
    f0_t = 130.0 + 10 * np.sin(2 * math.pi * 3 * t) + rng.normal(0, 2, n).cumsum() * 0.001
    f0_t = np.clip(f0_t, 110, 160)
    phase = 2 * math.pi * np.cumsum(f0_t) / SAMPLE_RATE
    # Time-varying formants emulate phone transitions, which Silero VAD relies on
    # to sustain a high speech probability. A static spectrum collapses to silence
    # in the model's internal state after ~150 ms.
    f1_t = 600.0 + 250.0 * np.sin(2 * math.pi * 4 * t + rng.uniform(0, 2 * math.pi))
    f2_t = 1500.0 + 700.0 * np.sin(2 * math.pi * 4 * t + 0.5 + rng.uniform(0, 2 * math.pi))
    f3_t = 2600.0 + 200.0 * np.sin(2 * math.pi * 4 * t + 1.0)
    sig = np.zeros(n)
    for h in range(1, 40):
        f_h = h * f0_t  # per-sample harmonic frequency
        amp_t = np.zeros(n)
        for fc_t, bw in [(f1_t, 80.0), (f2_t, 90.0), (f3_t, 100.0)]:
            amp_t += (bw ** 2) / ((f_h - fc_t) ** 2 + bw ** 2)
        sig += amp_t * np.sin(h * phase)
    sig /= np.max(np.abs(sig)) + 1e-9
    samples = (sig * amplitude * 32767).astype(np.int16)
    return samples.tobytes()
