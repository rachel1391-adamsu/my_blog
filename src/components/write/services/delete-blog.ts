import { toast } from 'sonner'
import { getAuthToken } from '@/lib/auth'
import { GITHUB_CONFIG } from '@/consts'
import { createCommit, createTree, getRef, getCommit, listRepoFilesRecursive, type TreeItem, updateRef } from '@/lib/github-client'

export async function deleteBlog(slug: string): Promise<void> {
	if (!slug) throw new Error('需要 slug')

	const token = await getAuthToken()
    const toastId = toast.loading('正在初始化删除...')

    try {
        toast.loading('正在获取分支信息...', { id: toastId })
        const refData = await getRef(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, `heads/${GITHUB_CONFIG.BRANCH}`)
        const latestCommitSha = refData.sha

        // 获取当前提交对应的 tree SHA，作为创建 tree 的 base
        const commitData = await getCommit(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, latestCommitSha)
        const baseTreeSha = commitData.tree.sha

        const imagesPath = `public/images/${slug}`
        const imageFiles = await listRepoFilesRecursive(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, imagesPath, GITHUB_CONFIG.BRANCH)
        
        const treeItems: TreeItem[] = []

        for (const path of imageFiles) {
            treeItems.push({
                path,
                mode: '100644',
                type: 'blob',
                sha: null // Delete
            })
        }
        
        treeItems.push({
            path: `src/content/blog/${slug}.md`,
            mode: '100644',
            type: 'blob',
            sha: null
        })
        treeItems.push({
            path: `src/content/blog/${slug}.mdx`,
            mode: '100644',
            type: 'blob',
            sha: null
        })

        toast.loading('正在创建文件树...', { id: toastId })
        const treeData = await createTree(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, treeItems, baseTreeSha)
        
        toast.loading('正在创建提交...', { id: toastId })
        const newCommitData = await createCommit(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, `删除文章: ${slug}`, treeData.sha, [latestCommitSha])

        toast.loading('正在更新分支...', { id: toastId })
        await updateRef(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, `heads/${GITHUB_CONFIG.BRANCH}`, newCommitData.sha)

        toast.success('删除成功！请等待部署完成后刷新页面', { id: toastId })
    } catch (error: any) {
        console.error(error)
        toast.error(error.message || '删除失败', { id: toastId })
        throw error
    }
}
