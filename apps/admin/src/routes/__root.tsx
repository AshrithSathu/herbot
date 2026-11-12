import { useEffect, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import styles from '../styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
      },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'color-scheme', content: 'light dark' },
      { title: 'Herbot admin' },
    ],
    links: [
      { rel: 'stylesheet', href: styles },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  component: () => (
    <Document>
      <Outlet />
      <Toaster position="bottom-right" />
    </Document>
  ),
})

/** When the system flips between light and dark, switch colours at once:
 * transitions are off for two frames (styles.css, `.theme-switching`). */
function useInstantThemeSwitch() {
  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: dark)')
    let frame = 0
    const onChange = () => {
      const root = document.documentElement
      root.classList.add('theme-switching')
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => root.classList.remove('theme-switching'))
      })
    }
    scheme.addEventListener('change', onChange)
    return () => {
      scheme.removeEventListener('change', onChange)
      cancelAnimationFrame(frame)
    }
  }, [])
}

function Document({ children }: { children: ReactNode }) {
  useInstantThemeSwitch()
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Browser chrome matches the canvas (--canvas in each theme). Written
            here, not in head(), because HeadContent keeps one meta per name. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#edf1f4" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b1015" />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
