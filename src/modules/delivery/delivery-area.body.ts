/**
 * PUT /organization/:id/delivery-area takes a larger JSON body than the rest of the API (drawn outlines, up to
 * 10 × 200 points); infra/errors/configure.ts registers this parser before the API-wide one (100 KB).
 */
export const DELIVERY_AREA_PATH = '/organization/:id/delivery-area';
export const DELIVERY_AREA_BODY_LIMIT = '256kb';
