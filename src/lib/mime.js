/**
 * Pure MIME helpers for outbound documents (no Baileys / socket dependency,
 * so they can be unit-tested directly).
 */

import path from 'path';

export const DEFAULT_DOCUMENT_MIME = 'application/octet-stream';

/**
 * File extension (lower case, without the dot) → MIME type for documents sent
 * with sendDocument(). WhatsApp uses the MIME type to pick the icon / viewer
 * and the extension shown to the recipient, so a generic octet-stream makes
 * e.g. a PDF arrive as ".bin".
 */
export const DOCUMENT_MIME_TYPES = Object.freeze({
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  apk: 'application/vnd.android.package-archive',
});

function mimeForName(name) {
  if (typeof name !== 'string' || !name) return null;
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!ext) return null;
  return Object.prototype.hasOwnProperty.call(DOCUMENT_MIME_TYPES, ext) ? DOCUMENT_MIME_TYPES[ext] : null;
}

/**
 * MIME type for an outbound document. Uses the display filename's extension
 * when it has one, otherwise the file path's; an unknown or missing extension
 * falls back to application/octet-stream (never throws).
 * @param {string} filePath - Path to the file being sent
 * @param {string} [filename] - Display filename, if different from the path
 * @returns {string}
 */
export function documentMimeType(filePath, filename) {
  const fromName = typeof filename === 'string' && path.extname(filename) ? filename : null;
  return mimeForName(fromName ?? filePath) ?? DEFAULT_DOCUMENT_MIME;
}
