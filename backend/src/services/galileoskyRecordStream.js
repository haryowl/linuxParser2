'use strict';

/**
 * Galileosky record-boundary helpers (protocol tag stream).
 * Records in a main/extension packet are sequential tag lists.
 * A new record typically starts at tag 0x10+0x20 or a second 0x20.
 */

function isArchiveRecordStart(buffer, offset, end) {
    if (offset + 3 >= end) {
        return false;
    }
    return buffer.readUInt8(offset) === 0x10 && buffer.readUInt8(offset + 3) === 0x20;
}

function isDatetimeRecordStart(buffer, offset, end) {
    if (offset >= end) {
        return false;
    }
    return buffer.readUInt8(offset) === 0x20;
}

/**
 * True when `offset` points to the start of the next record in a multi-record packet.
 */
function isNewRecordStart(buffer, offset, end, record) {
    if (!record || Object.keys(record.tags).length === 0) {
        return false;
    }
    if (isArchiveRecordStart(buffer, offset, end)) {
        return true;
    }
    if (record.tags['0x20'] && isDatetimeRecordStart(buffer, offset, end)) {
        return true;
    }
    return false;
}

module.exports = {
    isArchiveRecordStart,
    isDatetimeRecordStart,
    isNewRecordStart
};
