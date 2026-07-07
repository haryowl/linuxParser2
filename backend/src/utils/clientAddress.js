function extractClientIp(connectionAddress) {
    if (!connectionAddress || typeof connectionAddress !== 'string') {
        return '';
    }

    if (connectionAddress.startsWith('::ffff:')) {
        const hostPart = connectionAddress.slice('::ffff:'.length);
        const colon = hostPart.lastIndexOf(':');
        if (colon > -1 && hostPart.indexOf(':') === colon) {
            return hostPart.slice(0, colon);
        }
        return hostPart;
    }

    const lastColon = connectionAddress.lastIndexOf(':');
    if (lastColon > -1 && connectionAddress.includes('.')) {
        return connectionAddress.slice(0, lastColon);
    }

    return connectionAddress;
}

module.exports = {
    extractClientIp
};
