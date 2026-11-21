// ?debug=1 overlay: FPS, draw calls, player state.
export function createDebugOverlay(root, renderer, tilt) {
  const el = document.createElement('pre');
  el.id = 'debug';
  root.appendChild(el);
  let frames = 0, acc = 0, fps = 0, lastText = 0;
  return {
    frame(dt, game) {
      frames++; acc += dt;
      if (acc >= 0.5) { fps = frames / acc; frames = 0; acc = 0; }
      const now = performance.now();
      if (now - lastText < 250) return;
      lastText = now;
      const c = game.world.player;
      el.textContent =
        `FPS ${fps.toFixed(0)}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}  Q${game.qLevel}${game.qualityPinned ? '(pinned)' : ''} dpr ${renderer.getPixelRatio().toFixed(2)}  sim ${game.simMs.toFixed(1)}ms js ${game.cpuMs.toFixed(1)}ms gl ${game.submitMs.toFixed(1)}ms\n` +
        `s ${c.s.toFixed(0)}  d ${c.d.toFixed(1)}  v ${c.speed.toFixed(1)}  yaw ${c.yaw.toFixed(2)}  steer ${c.steer.toFixed(2)}\n` +
        `state ${c.state}  turbo ${c.turbosLeft}  respawns ${c.respawns}\n` +
        `tilt ${tilt.active ? 'ON' : 'off'}  ax ${tilt.raw.x.toFixed(1)} ay ${tilt.raw.y.toFixed(1)} angle ${tilt.raw.angle}  ` +
        `roll ${(tilt.roll * 57.3).toFixed(0)}° zero ${(tilt.zero * 57.3).toFixed(0)}° steer ${tilt.steer.toFixed(2)}${tilt.invert ? ' INV' : ''}${tilt.isIOS ? ' iOS' : ''} step ${tilt.step} jumps ${tilt.jumps}`;
    },
  };
}
