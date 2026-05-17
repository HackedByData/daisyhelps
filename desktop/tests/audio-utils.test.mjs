import { describe, it, expect } from 'vitest';
import { float32ToBase64Pcm16, base64Pcm16ToFloat32 } from '../src/renderer/audio-utils.ts';

describe('float32ToBase64Pcm16', () => {
  it('round-trips silence', () => {
    const input = new Float32Array(160);  // 10ms at 16kHz
    const b64 = float32ToBase64Pcm16(input);
    const out = base64Pcm16ToFloat32(b64);
    expect(out.length).toBe(input.length);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(0);
  });

  it('clamps and quantizes a sine sample correctly', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]);
    const b64 = float32ToBase64Pcm16(input);
    const out = base64Pcm16ToFloat32(b64);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(out[2]).toBeCloseTo(-0.5, 3);
    expect(out[3]).toBeCloseTo(1.0, 3);
    expect(out[4]).toBeCloseTo(-1.0, 3);
    expect(out[5]).toBeCloseTo(1.0, 3);   // clamped
    expect(out[6]).toBeCloseTo(-1.0, 3);  // clamped
  });
});
