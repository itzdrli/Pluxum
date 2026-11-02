<script setup lang="ts">
type Ping = { status: 'ok'; service: 'forum-api'; time: string }

// Runs during SSR (Nitro -> proxy route -> Pluxel) and is reused on hydration.
const { data: ping, error } = await useFetch<Ping>('/api/forum/ping')
</script>

<template>
	<section class="panel">
		<h1>论坛前台骨架</h1>
		<p class="muted">Nuxt SSR，API 经 Nitro 转发到 Pluxel host。</p>
		<dl class="status">
			<dt>API</dt>
			<dd v-if="ping" class="ok" data-testid="ping-status">
				{{ ping.service }} · {{ ping.status }} · <code>{{ ping.time }}</code>
			</dd>
			<dd v-else class="err" data-testid="ping-status">
				不可用{{ error ? `：${error.statusCode ?? ''} ${error.message}` : '' }}
			</dd>
		</dl>
	</section>
</template>

<style scoped>
.panel {
	padding: var(--fm-space-5);
	background: var(--fm-surface);
	border: 1px solid var(--fm-border);
	border-radius: var(--fm-radius-lg);
}

h1 {
	margin: 0 0 var(--fm-space-2);
	color: var(--fm-text-strong);
	font-size: var(--fm-text-xl);
}

.muted {
	margin: 0 0 var(--fm-space-4);
	color: var(--fm-text-muted);
}

.status {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: var(--fm-space-2) var(--fm-space-4);
	margin: 0;
}

dt {
	color: var(--fm-text-muted);
}

dd {
	margin: 0;
}

.ok {
	color: var(--fm-success);
}

.err {
	color: var(--fm-danger);
}
</style>
