# FlowStudio Terminal: run the user's own .zprofile. See .zshenv.
_fs_zdotdir=$ZDOTDIR
ZDOTDIR=${FLOWSTUDIO_USER_ZDOTDIR:-$HOME}
[[ -f $ZDOTDIR/.zprofile ]] && source $ZDOTDIR/.zprofile
ZDOTDIR=$_fs_zdotdir
unset _fs_zdotdir
