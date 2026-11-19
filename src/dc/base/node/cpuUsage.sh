#!/bin/bash

function get_total_cpu_time() {
  CPU=(`sed -n 's/^cpu\s//p' /proc/stat`)

  for VALUE in "${CPU[@]}"; do
    let $1=$1+$VALUE
  done
}

TOTAL_TIME_BEFORE=0
get_total_cpu_time TOTAL_TIME_BEFORE

declare -a PROCESS_BEFORE_TIMES
ITER=0
for PID in "$@"; do
  if [ -f /proc/$PID/stat ]
  then
    PROCESS_STATS=`cat /proc/$PID/stat`
    PROCESS_STAT_ARRAY=($PROCESS_STATS)

    let PROCESS_TIME_BEFORE="${PROCESS_STAT_ARRAY[13]}+${PROCESS_STAT_ARRAY[14]}"
  else
    let PROCESS_TIME_BEFORE=0
  fi

  PROCESS_BEFORE_TIMES[$ITER]=$PROCESS_TIME_BEFORE
  ((++ITER))
done

sleep 1

TOTAL_TIME_AFTER=0
get_total_cpu_time TOTAL_TIME_AFTER

ITER=0
for PID in "$@"; do
  if [ -f /proc/$PID/stat ]
  then
    PROCESS_STATS=`cat /proc/$PID/stat`
    PROCESS_STAT_ARRAY=($PROCESS_STATS)

    let PROCESS_TIME_AFTER="${PROCESS_STAT_ARRAY[13]}+${PROCESS_STAT_ARRAY[14]}"
  else
    let PROCESS_TIME_AFTER=${PROCESS_BEFORE_TIMES[$ITER]}
  fi

  PROCESS_TIME_BEFORE=${PROCESS_BEFORE_TIMES[$ITER]}
  let PROCESS_DELTA=$PROCESS_TIME_AFTER-$PROCESS_TIME_BEFORE
  let TOTAL_DELTA=$TOTAL_TIME_AFTER-$TOTAL_TIME_BEFORE
  CPU_USAGE=`echo "$((100*$PROCESS_DELTA/$TOTAL_DELTA))"`

  echo $CPU_USAGE
  ((++ITER))
done
