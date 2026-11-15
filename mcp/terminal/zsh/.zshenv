# FlowStudio Terminal. zsh reads this file because the pty sets ZDOTDIR to
# this folder. Each file here runs the user's own file of the same name, so
# their setup is unchanged. .zshrc and .zlogin then put the FlowStudio agent
# wrappers first on PATH, and .zlogin hands ZDOTDIR back.
_fs_zdotdir=$ZDOTDIR
ZDOTDIR=${FLOWSTUDIO_USER_ZDOTDIR:-$HOME}
[[ $ZDOTDIR == $_fs_zdotdir ]] && ZDOTDIR=$HOME
[[ -f $ZDOTDIR/.zshenv ]] && source $ZDOTDIR/.zshenv
# The user's .zshenv may move ZDOTDIR. Their other files live there.
[[ $ZDOTDIR != $HOME && $ZDOTDIR != $_fs_zdotdir ]] && export FLOWSTUDIO_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$_fs_zdotdir
unset _fs_zdotdir
