# FlowStudio Terminal: run the user's own .zlogin, the last startup file.
# See .zshenv.
_fs_zdotdir=$ZDOTDIR
ZDOTDIR=${FLOWSTUDIO_USER_ZDOTDIR:-$HOME}
[[ -f $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
unset _fs_zdotdir
[[ -n ${FLOWSTUDIO_TERMINAL_BIN-} ]] && path=($FLOWSTUDIO_TERMINAL_BIN ${path:#$FLOWSTUDIO_TERMINAL_BIN})
# Startup is over. Shells started from here read the user's own files.
if [[ -n ${FLOWSTUDIO_USER_ZDOTDIR-} ]]; then
  export ZDOTDIR=$FLOWSTUDIO_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
unset FLOWSTUDIO_USER_ZDOTDIR
