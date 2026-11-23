import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { LatLng, Ring } from '../domain/geometry';

export interface RegionName {
  uz: string;
  ru: string;
  en: string;
}

export interface Region {
  /** ISO 3166-2:UZ, e.g. UZ-TK */
  code: string;
  name: RegionName;
  /** [[south, west], [north, east]] */
  bbox: [LatLng, LatLng];
  /** Every ring of the region (outlines, holes, exclaves), even-odd: geometry.ts */
  rings: Ring[];
}

export interface RegionCatalogFile {
  /** Catalog version, copied into a venue area with the geometry (osm-YYYY-MM-DD) */
  version: string;
  license: string;
  attribution: string;
  source: {
    code: string;
    relation: number;
    osmVersion: number | null;
    timestamp: string | null;
  }[];
  regions: Region[];
}

/** Built by scripts/delivery-regions/build.ts; copied next to the compiled file (nest-cli.json assets). */
export const CATALOG_FILE = join(__dirname, 'uz-regions.json');

/**
 * The regions of Uzbekistan an owner can add to the venue delivery area whole (ISO 3166-2:UZ, 14 parts). Read
 * once, on first use. Updating the file does not change saved areas: they keep their copy and its version.
 */
@Injectable()
export class RegionCatalog {
  private data: RegionCatalogFile | null = null;
  private byCode: Map<string, Region> | null = null;

  private load(): { data: RegionCatalogFile; byCode: Map<string, Region> } {
    if (!this.data || !this.byCode) {
      this.data = JSON.parse(
        readFileSync(CATALOG_FILE, 'utf8'),
      ) as RegionCatalogFile;
      this.byCode = new Map(this.data.regions.map((r) => [r.code, r]));
    }
    return { data: this.data, byCode: this.byCode };
  }

  get version(): string {
    return this.load().data.version;
  }

  get license(): string {
    return this.load().data.license;
  }

  get attribution(): string {
    return this.load().data.attribution;
  }

  /** Every region in catalog order (by code). */
  list(): Region[] {
    return this.load().data.regions;
  }

  find(code: string): Region | null {
    return this.load().byCode.get(code) ?? null;
  }

  has = (code: string): boolean => this.find(code) !== null;
}
