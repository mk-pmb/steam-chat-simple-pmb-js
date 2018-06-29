#!/bin/bash
# -*- coding: utf-8, tab-width: 2 -*-


function oven_repl () {
  jsl oven{.repl,}.js || return $?
  local LOGIN=()
  readarray -t LOGIN < <(sed -nre '
    s~^\*?\s*(user|pswd)( [0-9-]+|):?\s~STEAM_\U\1\E=~ip
    ' -- logins.txt | head -n 2)
  export "${LOGIN[@]}"
  local LOGFN="$HOME/oven.$(date +%y%m%d-%H%M%S).$$.log"
  echo "D: using logfile $LOGFN"
  nodejs oven.repl.js |& tee -- "$LOGFN"
  return $?
}










[ "$1" == --lib ] && return 0; oven_repl "$@"; exit $?
