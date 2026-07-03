import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'EasyCite',
  description:
    'Fast citation search and insertion for Overleaf: DBLP, OpenReview, arXiv, ACL Anthology, Crossref, Europe PMC.',
  version: '0.3.3',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_popup: 'src/options/index.html',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
  permissions: ['storage'],
  host_permissions: [
    'https://www.overleaf.com/*',
    'https://dblp.org/*',
    'https://export.arxiv.org/*',
    'https://arxiv.org/*',
    'https://api2.openreview.net/*',
    'https://aclanthology.org/*',
    'https://api.crossref.org/*',
    'https://www.ebi.ac.uk/*',
  ],
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.overleaf.com/project/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  commands: {
    'open-easycite': {
      suggested_key: {
        default: 'Ctrl+Shift+E',
        mac: 'Command+Shift+E',
      },
      description: 'Open the EasyCite search overlay',
    },
  },
  options_page: 'src/options/index.html',
})
