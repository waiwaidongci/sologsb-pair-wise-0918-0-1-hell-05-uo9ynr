// localStorage 持久化：重载页面后配气单与混气档案仍可追溯
import type { ArchiveRecord, Banks, MixSheet } from "./types";
import { DEFAULT_BANKS } from "./domain";

const SHEETS_KEY = "gmr.sheets.v1";
const ARCHIVE_KEY = "gmr.archive.v1";
const BANKS_KEY = "gmr.banks.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用时静默降级为内存态
  }
}

export const store = {
  loadSheets: (): MixSheet[] => read<MixSheet[]>(SHEETS_KEY, []),
  saveSheets: (v: MixSheet[]) => write(SHEETS_KEY, v),
  loadArchive: (): ArchiveRecord[] => read<ArchiveRecord[]>(ARCHIVE_KEY, []),
  saveArchive: (v: ArchiveRecord[]) => write(ARCHIVE_KEY, v),
  loadBanks: (): Banks => read<Banks>(BANKS_KEY, DEFAULT_BANKS),
  saveBanks: (v: Banks) => write(BANKS_KEY, v),
};
