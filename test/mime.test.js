/**
 * Tests for the outbound document MIME helper (sendDocument mimetype).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { documentMimeType, DEFAULT_DOCUMENT_MIME, DOCUMENT_MIME_TYPES } from '../src/lib/mime.js';

describe('documentMimeType', () => {
  it('maps common document types by the file path extension', () => {
    assert.equal(documentMimeType('/tmp/report.pdf'), 'application/pdf');
    assert.equal(documentMimeType('/tmp/photo.png'), 'image/png');
    assert.equal(documentMimeType('/tmp/a.docx'), DOCUMENT_MIME_TYPES.docx);
    assert.equal(documentMimeType('/tmp/a.xlsx'), DOCUMENT_MIME_TYPES.xlsx);
  });

  it('is case-insensitive on the extension', () => {
    assert.equal(documentMimeType('/tmp/REPORT.PDF'), 'application/pdf');
    assert.equal(documentMimeType('/tmp/Photo.JpEg'), 'image/jpeg');
  });

  it('prefers the display filename extension over the path', () => {
    assert.equal(documentMimeType('/tmp/upload-123', 'invoice.pdf'), 'application/pdf');
    assert.equal(documentMimeType('/tmp/x.bin', 'sheet.xlsx'), DOCUMENT_MIME_TYPES.xlsx);
  });

  it('falls back to the path when the filename has no extension', () => {
    assert.equal(documentMimeType('/tmp/report.pdf', 'report'), 'application/pdf');
  });

  it('falls back to application/octet-stream for unknown or missing extensions', () => {
    assert.equal(DEFAULT_DOCUMENT_MIME, 'application/octet-stream');
    assert.equal(documentMimeType('/tmp/data.unknownext'), DEFAULT_DOCUMENT_MIME);
    assert.equal(documentMimeType('/tmp/noext'), DEFAULT_DOCUMENT_MIME);
    assert.equal(documentMimeType('/tmp/.hidden'), DEFAULT_DOCUMENT_MIME);
    assert.equal(documentMimeType('/tmp/a.toString'), DEFAULT_DOCUMENT_MIME); // no prototype keys
  });

  it('never throws on odd input', () => {
    assert.equal(documentMimeType(undefined), DEFAULT_DOCUMENT_MIME);
    assert.equal(documentMimeType('', ''), DEFAULT_DOCUMENT_MIME);
    assert.equal(documentMimeType('/tmp/a.pdf', null), 'application/pdf');
  });
});
