// db-utils.js — lightweight utilities

let writeChain = Promise.resolve();

export function withWriteLock(fn) {
	writeChain = writeChain
		.then(() => fn())
		.catch((e) => {
			console.error("DB operation failed", e);
		});
	return writeChain;
}
