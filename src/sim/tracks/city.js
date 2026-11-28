// The city at sunset: a closed loop, 2 laps, about 2 km (60 s) per lap. Flowing: no corner needs braking.
// A smooth closed curve from a few Fourier terms (so every bend is wide): about 1980 m per lap, tightest radius about 83 m.
// At the cruise speed (32 m/s) the sideways drift in the tightest bend is far below what the steering can hold: nothing needs braking.
const SHAPE = { a: 370, b: 185, c3: 36, d3: 36, c2: 60, d2: 30, start: 1.52 * Math.PI, count: 72 };
export const CITY_POINTS = Array.from({ length: SHAPE.count }, (_, i) => {
  const th = SHAPE.start + (i / SHAPE.count) * 2 * Math.PI, { a, b, c3, d3, c2, d2 } = SHAPE;
  return {
    x: a * Math.cos(th) + c3 * Math.cos(3 * th) + d3 * Math.sin(3 * th) + c2 * Math.cos(2 * th),
    z: b * Math.sin(th) + c3 * 0.7 * Math.sin(3 * th) - d3 * 0.7 * Math.cos(3 * th) + d2 * Math.sin(2 * th),
  };
});

export const city = {
  id: 'city', name: 'עיר בשקיעה', style: 'city', loop: true, laps: 2,
  points: CITY_POINTS, segments: [], ramps: [], obstacles: [], heightAt: () => 0,
  leadIn: 40, runOut: 120,
  runoff: 1.6,           // the kerb strip: the car is held on the road side of it (no slowdown, see CONFIG.car.SAND_MULT)
};
