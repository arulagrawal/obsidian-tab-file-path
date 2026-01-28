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

        this.setTabTitles();
    }

    setTabTitles() {
        const leaves = this.app.workspace.getLeavesOfType('markdown');

        const leafInfos = leaves.map(leaf => {
            const path = this.getLeafName(leaf);
            const parts = path.split('/').filter(Boolean);
            const fileName = parts[parts.length - 1] ?? '';
            return { leaf, path, parts, fileName };
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
        leaf.tabHeaderEl.setAttribute('aria-label', title);
        leaf.tabHeaderInnerTitleEl.innerText = title;
        leaf.tabHeaderInnerTitleEl.classList.add('tab__title');
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
