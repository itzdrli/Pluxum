// The footer's content is set in Workbench (Forum Core › 页脚) and arrives in `/meta`, merged with
// the links running plugins add through `core.registerFooterLinks(...)`.
//
//   groups  columns of text links with a heading ("社区", "文档", ...), shown on the left.
//           Empty: the footer stays one compact row.
//   icons   icon-only links on the bottom right (repo, chat, feed, ...).
//   notes   short lines in the bottom row: licence, filing number, copyright, ...
//
// Links starting with `/` stay in the forum; anything else opens in a new tab.

import type { FooterIcon, FooterLinkDto } from '@pluxum/domain'

export type { FooterIcon }

export type FooterLink = FooterLinkDto

export function isInternalHref(href: string): boolean {
	return href.startsWith('/') && !href.startsWith('//')
}
