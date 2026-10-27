export const toolList = {
    right: [
        {
            label: 'Insert Row Above',
            action: 'insert',
            location: 'previous',
            target: 'row',
        },
        {
            label: 'Insert Row Below',
            action: 'insert',
            location: 'next',
            target: 'row',
        },
        {
            label: 'Remove Row',
            action: 'remove',
            location: 'current',
            target: 'row',
        },
        // B07-1 修复：右缘拖拽条菜单此前只有行操作，UI 层没有任何列操作
        // 入口。补上列插入/删除项（复用既有 table.insertColumn/removeColumn
        // 引擎方法，作用于悬停单元格所在列），标签复用 locales 既有 key。
        {
            label: 'Insert Column left',
            action: 'insert',
            location: 'left',
            target: 'column',
        },
        {
            label: 'Insert Column right',
            action: 'insert',
            location: 'right',
            target: 'column',
        },
        {
            label: 'Remove Column',
            action: 'remove',
            location: 'current',
            target: 'column',
        },
    ],
    bottom: [
        {
            label: 'Insert Column Left',
            action: 'insert',
            location: 'left',
            target: 'column',
        },
        {
            label: 'Insert Column Right',
            action: 'insert',
            location: 'right',
            target: 'column',
        },
        {
            label: 'Remove Column',
            action: 'remove',
            location: 'current',
            target: 'column',
        },
    ],
};

export type MenuItem = typeof toolList['right'][number];
