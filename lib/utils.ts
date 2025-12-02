export function pLimit(concurrency: number) {
    const queue: (() => void)[] = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            const nextFn = queue.shift()!;
            activeCount++;
            nextFn();
        }
    };

    return async <T>(fn: () => Promise<T>): Promise<T> => {
        if (activeCount >= concurrency) {
            await new Promise<void>(resolve => queue.push(resolve));
        } else {
            activeCount++;
        }

        try {
            return await fn();
        } finally {
            next();
        }
    };
}
