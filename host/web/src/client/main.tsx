import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

// The forum frontend is the Nuxt app in apps/web; this host page only points operators there.
function HostPlaceholder() {
	return (
		<main className="placeholder">
			<h1>Pluxum host</h1>
			<p>
				论坛前台是独立的 Nuxt 应用（<code>apps/web</code>），开发时在 <code>:8082</code>。
			</p>
			<ul>
				<li>
					<a href="/__pluxel/workbench">Workbench</a>
				</li>
				<li>
					<a href="/api/forum/ping">
						<code>/api/forum/ping</code>
					</a>
				</li>
			</ul>
		</main>
	)
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
	<StrictMode>
		<HostPlaceholder />
	</StrictMode>,
)
