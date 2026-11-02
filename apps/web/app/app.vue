<template>
	<div class="shell">
		<header class="topbar">
			<NuxtLink to="/" class="brand">Pluxel Forum</NuxtLink>
		</header>
		<main class="content">
			<NuxtPage />
		</main>
	</div>
</template>

<style scoped>
.shell {
	min-height: 100vh;
	display: flex;
	flex-direction: column;
}

.topbar {
	display: flex;
	align-items: center;
	height: 48px;
	padding: 0 var(--fm-space-5);
	background: var(--fm-surface);
	border-bottom: 1px solid var(--fm-border);
}

.brand {
	color: var(--fm-text-strong);
	font-weight: 700;
	font-size: var(--fm-text-lg);
}

.content {
	width: 100%;
	max-width: 960px;
	margin: 0 auto;
	padding: var(--fm-space-6) var(--fm-space-5);
}
</style>
