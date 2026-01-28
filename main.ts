import {
    App,
    debounce,
    Plugin,
    PluginSettingTab,
    Setting,
    WorkspaceLeaf,
} from 'obsidian';

interface TabFilePathSettings {
    depth: number;
}

const DEFAULT_SETTINGS: TabFilePathSettings = {
    depth: 1,
};

export default class TabFilePathPlugin extends Plugin {
    settings: TabFilePathSettings;
    private tabTitleObserver: MutationObserver | null = null;
    private titleElementToLeaf = new WeakMap<HTMLElement, WorkspaceLeaf>();
    private isApplyingTitle = false;

    async onload() {
        // const workspaceEvents = [
        //     'active-leaf',
        //     'css-change',
        //     'editor-change',
        //     'editor-drop',
        //     'editor-menu',
        //     'editor-paste',
        //     'file-menu',
        //     'file-open',
        //     'files-menu',
        //     'layout-change',
        //     'quick-preview',
        //     'quit',
        //     'resize',
        //     'url-menu',
        //     'window-close',
        //     'window-open',
        // ];
        // workspaceEvents.forEach((event) => {
        //     this.registerEvent(this.app.workspace.on(event, () => console.log(`event: ${event}`)))
        // });

        await this.loadSettings();
        this.addSettingTab(new TabFilePathSettingTab(this.app, this));

        const setTabTitlesDebounced = debounce(this.setTabTitles.bind(this), 100);

        // Modifying leaf.tabHeaderInnerTitleEl in response to a 'file-open'
        // event doesn't seem to cause the tab UI to refresh properly.
        // Inspecting the element in dev tools shows it's been modified, but the
        // Obsidian UI isn't refreshing to show it.  Reacting to 'layout-change'
        // seems to work though, but it happens more frequently, so we just
        // debounce it and move on with life.
        this.registerEvent(this.app.workspace.on('layout-change', setTabTitlesDebounced));

        // Renaming a folder causes this to fire for all contained files, so
        // debounce this callback as well.
        this.registerEvent(this.app.vault.on('rename', setTabTitlesDebounced));

        this.startTabTitleObserver();
        this.setTabTitles();
    }

    onunload() {
        this.stopTabTitleObserver();
    }

    setTabTitles() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');

        const leafInfos = leaves.map(leaf => {
            const path = this.getLeafName(leaf);
            const parts = path.split('/').filter(Boolean);
            return { leaf, parts };
        });

        leafInfos.forEach((info) => {
            this.setLeafTitle(info.leaf, this.getTruncatedPath(info.parts));
        });
    }

    getLeafName(leaf: WorkspaceLeaf): string {
        const filePath = (leaf.isDeferred) ? leaf.view.state.file : leaf.view.file.path;
        return filePath.toLowerCase().endsWith('.md') ? filePath.slice(0, -3) : filePath;
    }

    setLeafTitle(leaf: WorkspaceLeaf, title: string) {
        // Note to self about related properties available depending on
        // the state of leaf.isDeferred:
        //
        // leaf.tabHeaderEl
        // leaf.tabHeaderInnerTitleEl
        // if (leaf.isDeferred) {
        //     leaf.view.title
        //     leaf.view.state.file (string)
        // } else {
        //     leaf.view.file (TFile?)
        //     leaf.view.titleEl
        //     leaf.view.titleContainerEl
        // }
        this.isApplyingTitle = true;
        try {
            const titleElement = leaf.tabHeaderInnerTitleEl;
            this.titleElementToLeaf.set(titleElement, leaf);
            leaf.tabHeaderEl.setAttribute('aria-label', title);
            titleElement.innerText = title;
            titleElement.classList.add('tab__title');
        } finally {
            this.isApplyingTitle = false;
        }
    }

    getTruncatedPath(parts: string[]): string {
        const depth = Number.isFinite(this.settings.depth) ? this.settings.depth : 0;
        if (depth <= 0) {
            return parts.join('/');
        }

        const sliceStart = Math.max(parts.length - (depth + 1), 0);
        return parts.slice(sliceStart).join('/');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getLeafTitle(leaf: WorkspaceLeaf): string {
        const path = this.getLeafName(leaf);
        const parts = path.split('/').filter(Boolean);
        return this.getTruncatedPath(parts);
    }

    startTabTitleObserver() {
        if (this.tabTitleObserver) {
            return;
        }

        this.tabTitleObserver = new MutationObserver((mutations) => {
            if (this.isApplyingTitle) {
                return;
            }

            for (const mutation of mutations) {
                const titleElement = this.getTitleElementFromMutation(mutation);
                if (!titleElement) {
                    continue;
                }

                const leaf = this.titleElementToLeaf.get(titleElement);
                if (!leaf) {
                    continue;
                }

                const expectedTitle = this.getLeafTitle(leaf);
                if (titleElement.innerText !== expectedTitle) {
                    this.setLeafTitle(leaf, expectedTitle);
                }
            }
        });

        this.tabTitleObserver.observe(this.app.workspace.containerEl, {
            subtree: true,
            childList: true,
            characterData: true,
        });
    }

    stopTabTitleObserver() {
        if (this.tabTitleObserver) {
            this.tabTitleObserver.disconnect();
            this.tabTitleObserver = null;
        }
    }

    getTitleElementFromMutation(mutation: MutationRecord): HTMLElement | null {
        const target = mutation.target;
        let element: HTMLElement | null = null;

        if (target instanceof HTMLElement) {
            element = target;
        } else if (target instanceof Text) {
            element = target.parentElement;
        }

        if (!element) {
            return null;
        }

        if (element.classList.contains('tab__title')) {
            return element;
        }

        return element.closest('.tab__title');
    }
}

class TabFilePathSettingTab extends PluginSettingTab {
    plugin: TabFilePathPlugin;

    constructor(app: App, plugin: TabFilePathPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Path depth')
            .setDesc('Number of parent folders to show with the filename. Use 0 for full path.')
            .addText((text) =>
                text
                    .setPlaceholder('1')
                    .setValue(String(this.plugin.settings.depth))
                    .onChange(async (value) => {
                        const parsed = Number.parseInt(value, 10);
                        this.plugin.settings.depth = Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
                        await this.plugin.saveSettings();
                        this.plugin.setTabTitles();
                    })
            );
    }
}
