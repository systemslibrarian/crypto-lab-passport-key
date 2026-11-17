/**
 * The one piece of state the exhibits share: which document is on the table.
 *
 * Exhibits 1 to 5 are a single story about one document, so the printed data
 * lives here rather than in any one panel. Changing it in exhibit 1 must
 * invalidate the keys in exhibit 2, the handshake in exhibit 3 and any
 * recording in exhibit 5 — which is the evidence-retirement rule §4.1b asks
 * for, applied across panels rather than within one.
 *
 * Nothing here is persisted. Invariant 2: the page never stores document data,
 * so there is no `localStorage` write in this file and a reload returns to the
 * ICAO specimen.
 */
import { keysFromPrintedData, type KeysFromPrintedData } from '../bac/kdf';
import { datesInYear } from '../bac/search';
import { ICAO_APPENDIX_D } from '../bac/vectors';
import type { PrintedData } from '../bac/mrz';

const SPECIMEN: PrintedData = {
  documentNumber: ICAO_APPENDIX_D.documentNumber,
  dateOfBirth: ICAO_APPENDIX_D.dateOfBirth,
  dateOfExpiry: ICAO_APPENDIX_D.dateOfExpiry,
};

let document_: PrintedData = SPECIMEN;
const listeners = new Set<(data: PrintedData) => void>();

export function currentDocument(): PrintedData {
  return document_;
}

/** Whether the document on the table is still ICAO's specimen. */
export function isSpecimen(): boolean {
  return (
    document_.documentNumber === SPECIMEN.documentNumber &&
    document_.dateOfBirth === SPECIMEN.dateOfBirth &&
    document_.dateOfExpiry === SPECIMEN.dateOfExpiry
  );
}

export function setDocument(data: PrintedData): void {
  // Normalise through the derivation so an invalid document can never reach
  // the store: `keysFromPrintedData` validates, and a throw here leaves the
  // previous document in place.
  keysFromPrintedData(data);
  document_ = data;
  for (const listener of listeners) listener(document_);
}

export function onDocumentChange(listener: (data: PrintedData) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keys the current document derives, recomputed on demand. */
export function currentKeys(): KeysFromPrintedData {
  return keysFromPrintedData(document_);
}

/**
 * A random fictional document.
 *
 * Invariant 2 again: the only two ways to get data into this page are the
 * ICAO specimen and this generator. The document number is two letters and
 * seven digits, which is a shape rather than any issuer's scheme — the page
 * says as much, because a generator that imitated a real numbering scheme
 * would be making a claim this lab explicitly does not make.
 *
 * The birth year is drawn from a leap year window on purpose, so the 29
 * February case shows up in exhibit 5's search space often enough to notice.
 */
export function randomFictionalDocument(): PrintedData {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = <T>(items: readonly T[] | string): T =>
    (items as readonly T[])[Math.floor(Math.random() * items.length)];

  let number = '';
  for (let i = 0; i < 2; i++) number += pick<string>(letters);
  for (let i = 0; i < 7; i++) number += String(Math.floor(Math.random() * 10));

  const birthYear = 60 + Math.floor(Math.random() * 40); // 1960-1999
  const expiryYear = 26 + Math.floor(Math.random() * 10); // a 10-year document
  const birthDates = datesInYear(birthYear);
  const expiryDates = datesInYear(expiryYear);

  return {
    documentNumber: number,
    dateOfBirth: birthDates[Math.floor(Math.random() * birthDates.length)],
    dateOfExpiry: expiryDates[Math.floor(Math.random() * expiryDates.length)],
  };
}
