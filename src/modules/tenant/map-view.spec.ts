import { resolveMapView } from './map-view';

const ZONE: [number, number][] = [
  [41.361, 69.201],
  [41.37, 69.28],
  [41.345, 69.33],
];
const none = { center: null, zoom: null };

describe('resolveMapView', () => {
  it('keeps the saved view, whatever the zone and branches say', () => {
    expect(
      resolveMapView({ center: { lat: 41.3, lng: 69.2 }, zoom: 15 }, ZONE, [
        [40, 68],
      ]),
    ).toEqual({ center: [41.3, 69.2], centerSource: 'saved', zoom: 15 });
  });

  it('keeps a saved center without a zoom as it is', () => {
    expect(
      resolveMapView(
        { center: { lat: 41.3, lng: 69.2 }, zoom: null },
        ZONE,
        [],
      ),
    ).toEqual({ center: [41.3, 69.2], centerSource: 'saved', zoom: null });
  });

  it('centers on the middle of the zone bounding box with a city zoom', () => {
    const view = resolveMapView(none, ZONE, [[40, 68]]);
    expect(view.centerSource).toBe('zone');
    expect(view.center![0]).toBeCloseTo(41.3575, 6);
    expect(view.center![1]).toBeCloseTo(69.2655, 6);
    expect(view.zoom).toBe(12);
  });

  it('falls back to the branches when there is no zone', () => {
    const view = resolveMapView(none, null, [
      [41.3, 69.2],
      [41.32, 69.3],
    ]);
    expect(view.centerSource).toBe('branches');
    expect(view.center![0]).toBeCloseTo(41.31, 6);
    expect(view.center![1]).toBeCloseTo(69.25, 6);
    expect(view.zoom).toBe(12);
  });

  it('treats an empty zone as no zone', () => {
    expect(resolveMapView(none, [], [[41.3, 69.2]]).centerSource).toBe(
      'branches',
    );
  });

  it('uses street zoom for a single branch', () => {
    expect(resolveMapView(none, null, [[41.3, 69.2]])).toEqual({
      center: [41.3, 69.2],
      centerSource: 'branches',
      zoom: 16,
    });
  });

  it('keeps a saved zoom next to a computed center', () => {
    expect(resolveMapView({ center: null, zoom: 14 }, ZONE, []).zoom).toBe(14);
  });

  it('clamps the zoom for a huge and for a tiny zone', () => {
    const huge: [number, number][] = [
      [30, 40],
      [45, 70],
    ];
    const tiny: [number, number][] = [
      [41.3, 69.2],
      [41.3001, 69.2001],
    ];
    expect(resolveMapView(none, huge, []).zoom).toBe(10);
    expect(resolveMapView(none, tiny, []).zoom).toBe(17);
  });

  it('answers no center when there is neither zone nor branch', () => {
    expect(resolveMapView(none, null, [])).toEqual({
      center: null,
      centerSource: null,
      zoom: null,
    });
  });
});
