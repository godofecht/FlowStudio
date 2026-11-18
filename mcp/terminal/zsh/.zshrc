# FlowStudio Terminal: run the user's own .zshrc. See .zshenv.
_fs_zdotdir=$ZDOTDIR
ZDOTDIR=${FLOWSTUDIO_USER_ZDOTDIR:-$HOME}
# /etc/zshrc set HISTFILE from ZDOTDIR while it pointed here. History
# belongs in the user's own file.
[[ ${HISTFILE-} == $_fs_zdotdir/* ]] && HISTFILE=$ZDOTDIR/.zsh_history
[[ -f $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
ZDOTDIR=$_fs_zdotdir
unset _fs_zdotdir
# Startup files often prepend to PATH. Put the agent wrappers first again.
[[ -n ${FLOWSTUDIO_TERMINAL_BIN-} ]] && path=($FLOWSTUDIO_TERMINAL_BIN ${path:#$FLOWSTUDIO_TERMINAL_BIN})
