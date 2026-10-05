// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			card?: string; // RTO id of the card open on /scan (phone back closes it)
		}
		// interface Platform {}
	}
}

export {};
