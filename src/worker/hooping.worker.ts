// SPDX-License-Identifier: GPL-3.0-or-later
import { expose } from 'comlink';
import { hoopingArchive } from '@/hooping/archive';
import { optimizeHoopLayout } from '@/hooping/optimize';
expose({ hoopingArchive, optimizeHoopLayout });
