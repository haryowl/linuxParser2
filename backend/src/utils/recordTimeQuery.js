const { Op, fn, col, where, literal } = require('sequelize');

const EFFECTIVE_TIME_SQL = 'COALESCE(datetime, timestamp)';

function effectiveTimeBetween(startDate, endDate) {
    return where(
        fn('COALESCE', col('datetime'), col('timestamp')),
        { [Op.between]: [new Date(startDate), new Date(endDate)] }
    );
}

function effectiveTimeGte(date) {
    return where(
        fn('COALESCE', col('datetime'), col('timestamp')),
        { [Op.gte]: new Date(date) }
    );
}

function effectiveTimeOrderDesc() {
    return [[literal(EFFECTIVE_TIME_SQL), 'DESC'], ['id', 'DESC']];
}

function effectiveTimeOrderAsc() {
    return [[literal(EFFECTIVE_TIME_SQL), 'ASC'], ['id', 'ASC']];
}

function appendTimeRangeFilter(where, startDate, endDate) {
    if (!startDate || !endDate) {
        return where;
    }

    const next = { ...where };
    const timeClause = effectiveTimeBetween(startDate, endDate);
    if (next[Op.and]) {
        next[Op.and] = [...next[Op.and], timeClause];
    } else {
        next[Op.and] = [timeClause];
    }
    delete next.datetime;
    return next;
}

function appendTimeGteFilter(where, sinceDate) {
    if (!sinceDate) {
        return where;
    }

    const next = { ...where };
    const timeClause = effectiveTimeGte(sinceDate);
    if (next[Op.and]) {
        next[Op.and] = [...next[Op.and], timeClause];
    } else {
        next[Op.and] = [timeClause];
    }
    delete next.datetime;
    return next;
}

/**
 * Fetch up to `limit` newest tracking points, returned in chronological order for map paths.
 */
async function findTrackingRecordsChronological(Record, {
    where: baseWhere = {},
    startDate,
    endDate,
    limit,
    attributes
}) {
    const where = appendTimeRangeFilter({ ...baseWhere }, startDate, endDate);
    const rows = await Record.findAll({
        where,
        attributes,
        order: effectiveTimeOrderDesc(),
        limit
    });
    return rows.reverse();
}

module.exports = {
    EFFECTIVE_TIME_SQL,
    effectiveTimeBetween,
    effectiveTimeGte,
    effectiveTimeOrderDesc,
    effectiveTimeOrderAsc,
    appendTimeRangeFilter,
    appendTimeGteFilter,
    findTrackingRecordsChronological
};
