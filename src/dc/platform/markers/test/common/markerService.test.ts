/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IMarkerData, MarkerSeverity } from '../../common/markers.js';
import * as markerService from '../../common/markerService.js';

function randomMarkerData(severity = MarkerSeverity.Error): IMarkerData {
	return {
		severity,
		message: Math.random().toString(16),
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 1
	};
}

suite('Marker Service', () => {

	let service: markerService.MarkerService;

	teardown(function () {
		service.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('query', () => {

		service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData(MarkerSeverity.Error)
		}]);

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ resource: URI.parse('file:///c/test/file.cs') }).length, 1);
		assert.strictEqual(service.read({ owner: 'far', resource: URI.parse('file:///c/test/file.cs') }).length, 1);


		service.changeAll('boo', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData(MarkerSeverity.Warning)
		}]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

		assert.strictEqual(service.read({ severities: MarkerSeverity.Error }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Warning }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Hint }).length, 0);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Error | MarkerSeverity.Warning }).length, 2);

	});


	test('changeOne override', () => {

		service = new markerService.MarkerService();
		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);

		service.changeOne('boo', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData(), randomMarkerData()]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

	});

	test('changeOne/All clears', () => {

		service = new markerService.MarkerService();
		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		service.changeOne('boo', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);
		assert.strictEqual(service.read().length, 2);

		service.changeOne('far', URI.parse('file:///path/only.cs'), []);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);
		assert.strictEqual(service.read().length, 1);

		service.changeAll('boo', []);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 0);
		assert.strictEqual(service.read().length, 0);
	});

	test('changeAll sends event for cleared', () => {

		service = new markerService.MarkerService();
		service.changeAll('far', [{
			resource: URI.parse('file:///d/path'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('file:///d/path'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);

		const d = service.onMarkerChanged(changedResources => {
			assert.strictEqual(changedResources.length, 1);
			changedResources.forEach(u => assert.strictEqual(u.toString(), 'file:///d/path'));
			assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		});

		service.changeAll('far', []);

		d.dispose();
	});

	test('changeAll merges', () => {
		service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
	});

	test('changeAll must not break integrety, issue #12635', () => {
		service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('scheme:path2'),
			marker: randomMarkerData()
		}]);

		service.changeAll('boo', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}]);

		service.changeAll('far', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('scheme:path2'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
		assert.strictEqual(service.read({ resource: URI.parse('scheme:path1') }).length, 2);
	});

	test('invalid marker data', () => {

		const data = randomMarkerData();
		service = new markerService.MarkerService();

		data.message = undefined!;
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);

		data.message = null!;
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);

		data.message = 'null';
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
	});

	test('MapMap#remove returns bad values, https://github.com/microsoft/vscode/issues/13548', () => {
		service = new markerService.MarkerService();

		service.changeOne('o', URI.parse('some:uri/1'), [randomMarkerData()]);
		service.changeOne('o', URI.parse('some:uri/2'), []);

	});

	test('Error code of zero in markers get removed, #31275', function () {
		const data = <IMarkerData>{
			code: '0',
			startLineNumber: 1,
			startColumn: 2,
			endLineNumber: 1,
			endColumn: 5,
			message: 'test',
			severity: 0 as MarkerSeverity,
			source: 'me'
		};
		service = new markerService.MarkerService();

		service.changeOne('far', URI.parse('some:thing'), [data]);
		const marker = service.read({ resource: URI.parse('some:thing') });

		assert.strictEqual(marker.length, 1);
		assert.strictEqual(marker[0].code, '0');
	});

	test('modelVersionId is preserved on IMarker when present in IMarkerData', () => {
		service = new markerService.MarkerService();
		const resource = URI.parse('file:///path/file.ts');

		const dataWithVersion: IMarkerData = {
			...randomMarkerData(),
			modelVersionId: 42
		};
		service.changeOne('owner', resource, [dataWithVersion]);

		const markersWithVersion = service.read({ resource });
		assert.strictEqual(markersWithVersion.length, 1);
		assert.strictEqual(markersWithVersion[0].modelVersionId, 42);

		const dataWithoutVersion: IMarkerData = randomMarkerData();
		service.changeOne('owner', resource, [dataWithoutVersion]);

		const markersWithoutVersion = service.read({ resource });
		assert.strictEqual(markersWithoutVersion.length, 1);
		assert.strictEqual(markersWithoutVersion[0].modelVersionId, undefined);
	});

	test('resource filter hides markers for the filtered resource', () => {
		service = new markerService.MarkerService();
		const resource1 = URI.parse('file:///path/file1.cs');
		const resource2 = URI.parse('file:///path/file2.cs');

		service.changeOne('owner1', resource1, [randomMarkerData()]);
		service.changeOne('owner1', resource2, [randomMarkerData()]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource: resource1 }).length, 1);
		assert.strictEqual(service.read({ resource: resource2 }).length, 1);

		const filter = service.installResourceFilter(resource1, 'Test filter');

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource: resource1 }).length, 1);
		assert.strictEqual(service.read({ resource: resource2 }).length, 1);

		filter.dispose();

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource: resource1 }).length, 1);
		assert.strictEqual(service.read({ resource: resource2 }).length, 1);
	});

	test('resource filter hides markers for the filtered resource UNLESS explicit read', () => {
		service = new markerService.MarkerService();
		const resource1 = URI.parse('file:///path/file1.cs');
		const resource2 = URI.parse('file:///path/file2.cs');

		service.changeOne('owner1', resource1, [randomMarkerData()]);
		service.changeOne('owner1', resource2, [randomMarkerData()]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource: resource1 }).length, 1);
		assert.strictEqual(service.read({ resource: resource2 }).length, 1);

		const filter = service.installResourceFilter(resource1, 'Test filter');

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource: resource1 }).length, 1);
		assert.strictEqual(service.read({ resource: resource2 }).length, 1);

		assert.strictEqual(service.read({ ignoreResourceFilters: true }).length, 2);
		assert.strictEqual(service.read({ resource: resource1, ignoreResourceFilters: true }).length, 1);
		assert.strictEqual(service.read({ resource: resource1, ignoreResourceFilters: true })[0].severity, MarkerSeverity.Error);
		assert.strictEqual(service.read({ resource: resource2, ignoreResourceFilters: true }).length, 1);
		assert.strictEqual(service.read({ resource: resource2, ignoreResourceFilters: true })[0].severity, MarkerSeverity.Error);

		filter.dispose();
	});

	test('resource filter affects all filter combinations', () => {
		service = new markerService.MarkerService();
		const resource = URI.parse('file:///path/file.cs');

		service.changeOne('owner1', resource, [randomMarkerData(MarkerSeverity.Error)]);
		service.changeOne('owner2', resource, [randomMarkerData(MarkerSeverity.Warning)]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource }).length, 2);
		assert.strictEqual(service.read({ owner: 'owner1' }).length, 1);
		assert.strictEqual(service.read({ owner: 'owner2' }).length, 1);
		assert.strictEqual(service.read({ owner: 'owner1', resource }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Error }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Warning }).length, 1);

		const filter = service.installResourceFilter(resource, 'Filter reason');

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);
		assert.strictEqual(service.read({ owner: 'owner1' }).length, 1);
		assert.strictEqual(service.read({ owner: 'owner2' }).length, 1);

		const ownerResourceMarkers = service.read({ owner: 'owner1', resource });
		assert.strictEqual(ownerResourceMarkers.length, 1);
		assert.strictEqual(ownerResourceMarkers[0].severity, MarkerSeverity.Info);
		assert.strictEqual(ownerResourceMarkers[0].owner, 'markersFilter');

		assert.strictEqual(service.read({ severities: MarkerSeverity.Error }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Warning }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Info }).length, 1);

		filter.dispose();
		assert.strictEqual(service.read().length, 2);
	});

	test('multiple filters for same resource are handled correctly', () => {
		service = new markerService.MarkerService();
		const resource = URI.parse('file:///path/file.cs');

		service.changeOne('owner1', resource, [randomMarkerData()]);

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		const filter1 = service.installResourceFilter(resource, 'First filter');
		const filter2 = service.installResourceFilter(resource, 'Second filter');

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		filter1.dispose();

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		filter2.dispose();

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);
	});

	test('resource filter with reason shows info marker when markers are filtered', () => {
		service = new markerService.MarkerService();
		const resource = URI.parse('file:///path/file.cs');

		service.changeOne('owner1', resource, [
			randomMarkerData(MarkerSeverity.Error),
			randomMarkerData(MarkerSeverity.Warning)
		]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ resource }).length, 2);

		const filterReason = 'Test filter reason';
		const filter = service.installResourceFilter(resource, filterReason);

		const markers = service.read({ resource });
		assert.strictEqual(markers.length, 1);
		assert.strictEqual(markers[0].severity, MarkerSeverity.Info);
		assert.ok(markers[0].message.includes(filterReason));

		filter.dispose();
		assert.strictEqual(service.read({ resource }).length, 2);
	});

	test('reading all markers shows info marker for filtered resources', () => {
		service = new markerService.MarkerService();
		const resource1 = URI.parse('file:///path/file1.cs');
		const resource2 = URI.parse('file:///path/file2.cs');

		service.changeOne('owner1', resource1, [randomMarkerData()]);
		service.changeOne('owner1', resource2, [randomMarkerData()]);

		assert.strictEqual(service.read().length, 2);

		const filterReason = 'Resource is being edited';
		const filter = service.installResourceFilter(resource1, filterReason);

		const allMarkers = service.read();

		assert.strictEqual(allMarkers.length, 2);

		const infoMarker = allMarkers.find(marker =>
			marker.owner === 'markersFilter' &&
			marker.severity === MarkerSeverity.Info
		);

		assert.ok(infoMarker);
		assert.strictEqual(infoMarker?.resource.toString(), resource1.toString());
		assert.ok(infoMarker?.message.includes(filterReason));

		filter.dispose();
	});

	test('out of order filter disposal works correctly', () => {
		service = new markerService.MarkerService();
		const resource = URI.parse('file:///path/file.cs');

		service.changeOne('owner1', resource, [randomMarkerData()]);

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		const filter1 = service.installResourceFilter(resource, 'First filter');
		const filter2 = service.installResourceFilter(resource, 'Second filter');
		const filter3 = service.installResourceFilter(resource, 'Third filter');

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		filter2.dispose();

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);

		const markers = service.read({ resource });
		assert.ok(markers[0].message.includes('Problems are paused because'));

		filter3.dispose();
		filter1.dispose();

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ resource }).length, 1);
	});
});
