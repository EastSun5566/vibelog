import type { FC, PropsWithChildren } from 'hono/jsx';

/**
 * Base layout component for all pages
 * Uses Sakura.css - a classless CSS framework for beautiful semantic HTML
 */
export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({ title = 'VibeLog', children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {/* Sakura.css - classless CSS framework */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/sakura.css/css/sakura.css"
          media="screen"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/sakura.css/css/sakura-dark.css"
          media="screen and (prefers-color-scheme: dark)"
        />
        <style>{`
          /* Minimal custom styles for specific UI needs */
          nav a {
            margin-right: 1rem;
          }
          
          .status-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-size: 0.85rem;
            font-weight: 500;
            margin-left: 0.5rem;
          }
          
          .status-success {
            background: #d4edda;
            color: #155724;
          }
          
          .status-warning {
            background: #fff3cd;
            color: #856404;
          }
          
          .status-info {
            background: #d1ecf1;
            color: #0c5460;
          }
          
          @media (prefers-color-scheme: dark) {
            .status-success {
              background: #155724;
              color: #d4edda;
            }
            
            .status-warning {
              background: #856404;
              color: #fff3cd;
            }
            
            .status-info {
              background: #0c5460;
              color: #d1ecf1;
            }
          }
          
          button:disabled, a[disabled] {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </head>
      <body>
        <header>
          <h1>🎨 VibeLog</h1>
          <nav>
            <a href="/">Home</a>
            <a href="/projects">Projects</a>
            <a href="/projects/new">New Project</a>
          </nav>
        </header>
        <main>
          {children}
        </main>
      </body>
    </html>
  );
};
