#!/bin/sh

i=1
while [ $i -le 30 ];do
  err=$(mktemp)
  "$@" 2>$err

  test -f $err || break
  cat $err >&2

  retry=false

  if grep -q 'Could not get lock' $err;then
    retry=true
  elif grep -q 'Could not open file /var/lib/apt/lists' $err;then
    retry=true
  elif grep -q 'IPC connect call failed' $err;then
    retry=true
  elif grep -q 'Temporary failure in name resolution' $err;then
    retry=true
  elif grep -q 'dpkg frontend is locked by another process' $err;then
    retry=true
  elif grep -q 'Failed to fetch' $err;then
    retry=true
  elif grep -q 'Unable to fetch some archives' $err;then
    retry=true
  fi

  rm $err
  if [ $retry = false ]; then
    break
  fi

  sleep 5
  echo "...retry $i"
  i=$((i + 1))
done
