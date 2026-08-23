/**
 * The whole-book tag sweep. The only thing worth pinning is the page numbering:
 * the cover sits at index 0 with no Page_N image behind it, so the first tagged
 * page must be 1, not 0 — an off-by-one here silently 404s every page.
 */
import { tagBook } from '../imageAnalysis';

const PAGES = {
  Cover: { text: [{ Dialogue: 'The Pattern Pals' }] },
  PageOne: { text: [{ Dialogue: 'Clara found <emphasis>Zoe</emphasis> here.' }] },
  PageTwo: { text: [{ Dialogue: 'Zoe sang.' }, { Dialogue: 'Clara smiled.' }] },
  PageThree: {},
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ tags: [] }) }));
});

test('tags every page but the cover, numbered from 1', async () => {
  const seen = [];
  const total = await tagBook(9, PAGES, (done, t) => seen.push([done, t]));

  expect(total).toBe(3);
  const bodies = global.fetch.mock.calls.map(([, opt]) => JSON.parse(opt.body));
  expect(bodies.map(b => b.page)).toEqual([1, 2, 3]);
  expect(bodies.every(b => b.book === 9)).toBe(true);
  expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
});

test('page text is joined and stripped of SSML; a textless page sends empty', async () => {
  await tagBook(9, PAGES);
  const bodies = global.fetch.mock.calls.map(([, opt]) => JSON.parse(opt.body));
  expect(bodies[0].pageText).toBe('Clara found Zoe here.');
  expect(bodies[1].pageText).toBe('Zoe sang. Clara smiled.');
  expect(bodies[2].pageText).toBe('');
});

test('the sweep forces a re-tag rather than reading either cache', async () => {
  await tagBook(9, PAGES);
  await tagBook(9, PAGES); // second sweep must hit the network again
  expect(global.fetch).toHaveBeenCalledTimes(6);
  expect(global.fetch.mock.calls.every(([, opt]) => opt.headers['x-bypass-cache'] === '1')).toBe(true);
});
