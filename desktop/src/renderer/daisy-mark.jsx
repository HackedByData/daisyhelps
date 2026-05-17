// daisy-mark.jsx — Daisy's visual presence, using custom illustrated assets.
// All images share the same 2048×2048 canvas coordinate system.
// Stacking them at the same scale+offset composes the full flower.

function DaisyMark({ state = 'idle', size, pos }) {
  const PETALS = ['petal1-removebg-preview','petal2-removebg-preview','petal3-removebg-preview','petal4-removebg-preview','petal5-removebg-preview','petal6-removebg-preview'];

  // Petal positioning — shared canvas coordinate system
  const w  = pos ? `${pos.scale * 100}%` : 'calc(var(--mk-scale, 4) * 100%)';
  const ox = pos ? `${pos.originX}%`     : 'var(--mk-ox, 22.5%)';
  const oy = pos ? `${pos.originY}%`     : 'var(--mk-oy, 25.5%)';

  const petalStyle = {
    position: 'absolute',
    width: w,
    height: w,
    left: pos ? `${pos.offsetX}%` : 'var(--mk-x, -40%)',
    top:  pos ? `${pos.offsetY}%` : 'var(--mk-y, -52%)',
    objectFit: 'contain',
    pointerEvents: 'none',
    transformOrigin: `${ox} ${oy}`,
  };

  // Center + face: same scale as petals, independently positionable.
  // pos.center can be {x, y} (fixed) or {idle, listening, thinking, speaking} (per-state).
  // Per-state center lookup; missing states fall back to idle, then the whole object (for fixed {x,y}).
  const centerPos = pos?.center
    ? (pos.center[state] ?? pos.center.idle ?? pos.center)
    : null;
  const centerStyle = {
    position: 'absolute',
    width:  petalStyle.width,
    height: petalStyle.height,
    left:   centerPos ? `${centerPos.x}%` : 'var(--mk-cx, -40%)',
    top:    centerPos ? `${centerPos.y}%` : 'var(--mk-cy, -52%)',
    objectFit: 'contain',
    pointerEvents: 'none',
    transformOrigin: `${ox} ${oy}`,
  };

  return (
    <div
      className="mark"
      data-state={state}
      style={size ? { width: size, height: size } : null}
      aria-hidden="true"
    >
      <span className="ring" />
      <span className="ring" />
      <span className="ring" />

      <div className="mark__flower" style={{ position: 'absolute', inset: 0, transformOrigin: `${ox} ${oy}` }}>
        {PETALS.map((p) => (
          <img
            key={p}
            className="mark__petal"
            src={`assets/${p}.png`}
            alt=""
            style={petalStyle}
          />
        ))}
        <img
          className="mark__core"
          src="assets/center-removebg-preview.png"
          alt=""
          style={{ ...centerStyle, zIndex: 1 }}
        />
        <img
          src="assets/face-removebg-preview.png"
          alt=""
          style={{ ...centerStyle, zIndex: 2 }}
        />
      </div>
    </div>
  );
}

Object.assign(window, { DaisyMark });
