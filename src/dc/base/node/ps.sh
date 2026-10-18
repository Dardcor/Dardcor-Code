#!/bin/sh
PAGESIZE=`getconf PAGESIZE`;
TOTAL_MEMORY=`cat /proc/meminfo | head -n 1 | awk '{print $2}'`;

for pid in `cd /proc && ls -d [0-9]*`
	do {
		if [ -e /proc/$pid/stat ]
		then
			echo $pid;

			awk '{print $4}' /proc/$pid/stat;

			echo "0.0"

			RESIDENT_SET_SIZE=`awk '{print $24}' /proc/$pid/stat`;
			PERCENT_MEMORY=$(((1000 * $PAGESIZE * $RESIDENT_SET_SIZE) / ($TOTAL_MEMORY * 1024)));
			if [ $PERCENT_MEMORY -lt 10 ]
			then
				echo $PERCENT_MEMORY | sed 's/.$/0.&/';
			else
				echo $PERCENT_MEMORY | sed 's/.$/.&/';
			fi

			xargs -0 < /proc/$pid/cmdline;
		fi
	} | tr "\n" "\t";
	echo;
done
