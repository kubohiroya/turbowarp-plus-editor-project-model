export const literalSearchPattern = (query: string, flags: string) =>
    new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

/** Match normalized text, returning ranges in the unchanged source (UTF-16). */
export function* literalSearchMatches(source: string, query: string) {
    const pattern = literalSearchPattern(query.normalize('NFC'), 'giu');
    const normalized = source.normalize('NFC');
    const segments = source === normalized ? undefined :
        new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(source)[Symbol.iterator]();
    let current = segments?.next().value;
    let text = current?.segment.normalize('NFC') ?? '';
    let start = 0;

    // Match boundaries arrive in order, so the source is traversed at most once.
    const originalOffset = (offset: number): number | undefined => {
        if (!segments) return offset;
        while (current && offset > start + text.length) {
            start += text.length;
            current = segments.next().value;
            text = current?.segment.normalize('NFC') ?? '';
        }
        if (!current) return;
        const within = offset - start;
        if (current.segment === text) return current.index + within;
        if (within === 0) return current.index;
        if (within === text.length) return current.index + current.segment.length;
        // Only splice at a boundary whose two sides normalize independently.
        // This prevents dropping a combining mark or editing a noncontiguous span.
        for (let i = 1; i < current.segment.length; i++) {
            const before = current.segment.slice(0, i).normalize('NFC');
            if (before.length === within && before + current.segment.slice(i).normalize('NFC') === text) {
                return current.index + i;
            }
        }
    };

    for (const match of normalized.matchAll(pattern)) {
        const start = originalOffset(match.index);
        const end = originalOffset(match.index + match[0].length);
        if (start !== undefined && end !== undefined) {
            yield {start, end, expectedText: source.slice(start, end)};
        }
    }
}
