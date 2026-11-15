// In development @openuidev/react-lang mounts its own floating inspector into <body> (its own
// colours and fonts, outside the forum's design). It skips that when this flag is already set, so
// this module must be imported before react-lang. Production builds drop the inspector anyway.
const AUTO_MOUNT_FLAG = Symbol.for('openui.devtools.autoMount')
Reflect.set(globalThis, AUTO_MOUNT_FLAG, true)
