"""Streaming VAD wrapper around silero-vad.

Accepts 16 kHz mono 16-bit PCM bytes via `ingest()`. Yields the full utterance
PCM (concatenated speech frames) when ~`silence_ms` of post-speech silence has
been seen. Returns None until an utterance boundary closes.
"""
from __future__ import annotations

import numpy as np
from loguru import logger
from silero_vad import VADIterator, load_silero_vad

SILERO_WINDOW_SAMPLES = 512  # ~32 ms at 16 kHz; Silero's required window size


class VADBuffer:
    def __init__(self, sample_rate: int = 16000, silence_ms: int = 700) -> None:
        if sample_rate != 16000:
            raise ValueError("VADBuffer only supports 16 kHz")
        self.sample_rate = sample_rate
        self.silence_ms = silence_ms
        self._model = load_silero_vad()
        self._iterator = VADIterator(
            self._model,
            sampling_rate=sample_rate,
            min_silence_duration_ms=silence_ms,
        )
        self._leftover_samples = np.empty((0,), dtype=np.float32)
        self._utterance_samples = np.empty((0,), dtype=np.float32)
        self._in_speech = False

    def ingest(self, pcm_bytes: bytes) -> bytes | None:
        """Push PCM bytes; return full utterance PCM bytes when speech ends, else None."""
        if not pcm_bytes:
            return None

        # Decode int16 LE -> float32 in [-1, 1]
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        # Prepend leftover from previous call
        if self._leftover_samples.size:
            samples = np.concatenate([self._leftover_samples, samples])
            self._leftover_samples = np.empty((0,), dtype=np.float32)

        utterance_to_emit: bytes | None = None

        # Process in 512-sample windows
        i = 0
        while i + SILERO_WINDOW_SAMPLES <= len(samples):
            window = samples[i:i + SILERO_WINDOW_SAMPLES]
            event = self._iterator(window, return_seconds=False)

            if self._in_speech:
                self._utterance_samples = np.concatenate([self._utterance_samples, window])

            if event is not None:
                if "start" in event:
                    self._in_speech = True
                    # Include the starting window itself
                    if self._utterance_samples.size == 0:
                        self._utterance_samples = window.copy()
                if "end" in event:
                    self._in_speech = False
                    # Emit the utterance
                    int16 = (self._utterance_samples * 32767.0).clip(-32768, 32767).astype(np.int16)
                    utterance_to_emit = int16.tobytes()
                    self._utterance_samples = np.empty((0,), dtype=np.float32)
                    logger.debug(f"VAD emit utterance {len(utterance_to_emit)} bytes")
                    break  # one utterance per ingest() call

            i += SILERO_WINDOW_SAMPLES

        # Save any leftover unprocessed samples for next ingest()
        self._leftover_samples = samples[i:]
        return utterance_to_emit

    def reset(self) -> None:
        self._iterator.reset_states()
        self._leftover_samples = np.empty((0,), dtype=np.float32)
        self._utterance_samples = np.empty((0,), dtype=np.float32)
        self._in_speech = False
