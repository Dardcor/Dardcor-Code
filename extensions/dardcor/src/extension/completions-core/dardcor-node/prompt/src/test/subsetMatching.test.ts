/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { DocumentInfoWithOffset, SimilarFileInfo } from '../prompt';
import {
	defaultSimilarFilesOptions,
	getSimilarSnippets,
	SimilarFilesOptions,
} from '../snippetInclusion/similarFiles';
import { SnippetWithProviderInfo } from '../snippetInclusion/snippets';

async function findAndScoreBlocks(
	referenceDoc: DocumentInfoWithOffset,
	relatedFiles: SimilarFileInfo[],
	useSubsetMatching: boolean
): Promise<SnippetWithProviderInfo[]> {
	const options: SimilarFilesOptions = {
		snippetLength: defaultSimilarFilesOptions.snippetLength,
		threshold: defaultSimilarFilesOptions.threshold,
		maxTopSnippets: defaultSimilarFilesOptions.maxTopSnippets,
		maxCharPerFile: defaultSimilarFilesOptions.maxCharPerFile,
		maxNumberOfFiles: defaultSimilarFilesOptions.maxNumberOfFiles,
		maxSnippetsPerFile: defaultSimilarFilesOptions.maxSnippetsPerFile,
		useSubsetMatching,
	};

	return getSimilarSnippets(referenceDoc, relatedFiles, options);
}

function fileScore(snippets: SnippetWithProviderInfo[], partialFileName: string): number {
	for (const snippet of snippets) {
		if (snippet.relativePath?.indexOf(partialFileName) !== -1) {
			return snippet.score;
		}
	}

	assert(false, 'Expected valid file name');
}

suite('Similar files with subset matching Test Suite', function () {
	test('Only current method is considered as part of reference tokens', async function () {
		const file0 = `
		public static class TestClass
		{
			public static void UnrelatedMethod(IBar bar)
			{
				var thing = UnrelatedThing();
				thing.DistractingMethodName();
			}

			public static void Foo(IBar bar)
			{
				var service = bar.GetService(typeof(IBaz));

				service.DoTheThing();
				|
			}

			public static void UnrelatedMethod2(IBar bar)
			{
				// This method is unrelated but can DoTheThing to a service
			}
		}
		`;

		const file1 = `
		public interface IBar
		{
			public object GetService(Type type);
		}
		`;

		const file2 = `
		public interface IBaz
		{
			public static void DoTheThing();
		}
		`;

		const file3 = `
		public static class DistractionClass
		{
			public DistractionClass UnrelatedThing()
			{
				TestClass.UnrelatedMethod(null);

				UnrelatedMethod(null);
			}

			public void DistractingMethodName()
			{
				TestClass.UnrelatedMethod2(null);
			}
		}
		`;

		const oldScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			false
		);

		assert(
			fileScore(oldScores, 'file3') > fileScore(oldScores, 'file2') &&
			fileScore(oldScores, 'file2') > fileScore(oldScores, 'file1'),
			'Expected 60-line-delimited reference chunks to prefer the distraction class because it resembles neighboring methods'
		);

		const newScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			true
		);

		assert(
			fileScore(newScores, 'file2') > fileScore(newScores, 'file1') &&
			fileScore(newScores, 'file1') > fileScore(newScores, 'file3'),
			'Expected that the file containing IBaz interface would be the best match'
		);
	});

	test('Methods are not penalized for being supersets of the reference chunk', async function () {
		const file0 = `
			public static class TestClass
			{
				public static void Foo(Bar bar)
				{
					bar.Baz();
					|
				}
			}
			`;

		const file1 = `
			public class Bar
			{
				public void Baz()
				{
					// This method has a bunch of extra tokens that don't match file0 and collectively
					// reduce its score relative to the other files.
				}
			}
			`;

		const file2 = `
			public class Bar2
			{
				public void Baz()
				{
				}
			}
			`;

		const file3 = `
			public class Bar3
			{
				public void Baz3()
				{
				}
			}
			`;

		const oldScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			false
		);

		assert(
			fileScore(oldScores, 'file2') > fileScore(oldScores, 'file1') &&
			fileScore(oldScores, 'file1') === fileScore(oldScores, 'file3'),
			'Expected 60-line-delimited reference chunks to prefer the distraction class because it resembles neighboring methods'
		);

		const newScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			true
		);

		assert(
			fileScore(newScores, 'file1') > fileScore(newScores, 'file2') &&
			fileScore(newScores, 'file2') > fileScore(newScores, 'file3'),
			'Expected subset matching method to prefer the file with the most token matches'
		);
	});

	test('Only current class is considered as part of reference tokens', async function () {
		const file0 = `

		public static class TestClass2
		{
			public static void UnrelatedMethod(IBar bar)
			{
				var thing = UnrelatedThing();
				thing.DistractingMethodName();
			}
		}

		public static class TestClass
		{
			public static void Foo(IBar bar)
			{
				var service = bar.GetService(typeof(IBaz));

				service.DoTheThing();
			}

			|
		}

		public static class TestClass3
		{
			public static void UnrelatedMethod2(IBar bar)
			{
				// This method is unrelated but can DoTheThing to a service
			}
		}
		`;

		const file1 = `
		public interface IBar
		{
			public object GetService(Type type);
		}
		`;

		const file2 = `
		public interface IBaz
		{
			public static void DoTheThing();
		}
		`;

		const file3 = `
		public static class DistractionClass
		{
			public DistractionClass UnrelatedThing()
			{
				TestClass.UnrelatedMethod(null);

				UnrelatedMethod(null);
			}

			public void DistractingMethodName()
			{
				TestClass.UnrelatedMethod2(null);
			}
		}
		`;

		const oldScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			false
		);

		assert(
			fileScore(oldScores, 'file3') > fileScore(oldScores, 'file2') &&
			fileScore(oldScores, 'file2') > fileScore(oldScores, 'file1'),
			'Expected 60-line-delimited reference chunks to prefer the distraction class because it resembles neighboring methods'
		);

		const newScores = await findAndScoreBlocks(
			{ source: file0, uri: 'file:///home/user/file0.js', languageId: 'csharp', offset: file0.indexOf('|') },
			[
				{ source: file1, uri: 'file:///home/user/file1.js', relativePath: 'file1' },
				{ source: file2, uri: 'file:///home/user/file2.js', relativePath: 'file2' },
				{ source: file3, uri: 'file:///home/user/file3.js', relativePath: 'file3' },
			],
			true
		);

		assert(
			fileScore(newScores, 'file2') > fileScore(newScores, 'file3') &&
			fileScore(newScores, 'file3') === fileScore(newScores, 'file1'),
			'Expected that the file containing IBaz interface would be the best match'
		);
	});
});
