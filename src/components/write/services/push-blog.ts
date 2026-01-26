// 记得在顶部 import 里加上 getCommit
import { 
    toBase64Utf8, 
    getRef, 
    getCommit, // <--- 必须确保引入了这个！
    createTree, 
    createCommit, 
    updateRef, 
    createBlob, 
    type TreeItem 
} from '@/lib/github-client'
import { fileToBase64NoPrefix, hashFileSHA256 } from '@/lib/file-utils'
import { getAuthToken } from '@/lib/auth'
import { GITHUB_CONFIG } from '@/consts'
import type { ImageItem, PublishForm } from '../types'
import { getFileExt, formatDateTimeLocal } from '@/lib/utils'
import { toast } from 'sonner'
import { stringifyFrontmatter } from '@/lib/frontmatter'

export type PushBlogParams = {
    form: PublishForm
    cover?: ImageItem | null
    images?: ImageItem[]
    mode?: 'create' | 'edit'
    originalSlug?: string | null
}

export async function pushBlog(params: PushBlogParams): Promise<void> {
    const { form, cover, images, mode = 'create', originalSlug } = params

    if (!form?.slug) throw new Error('需要 slug')

    const token = await getAuthToken()
    const toastId = toast.loading('🚀 正在初始化发布...')

    try {
        // 1. 获取最新 Commit SHA
        toast.loading('📡 正在同步分支信息...', { id: toastId })
        const refData = await getRef(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, `heads/${GITHUB_CONFIG.BRANCH}`)
        const latestCommitSha = refData.sha
        
        console.log('✅ Latest Commit SHA:', latestCommitSha)

        // 2. 【关键修改】通过 Commit SHA 获取 Tree SHA
        // 422 错误的根源通常在这里：不能直接用 Commit SHA 去创建 Tree
        const commitData = await getCommit(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, latestCommitSha)
        const latestTreeSha = commitData.tree.sha
        
        console.log('✅ Base Tree SHA:', latestTreeSha) // 调试：确保这个值和上面的不一样

        const commitMessage = mode === 'edit' ? `feat(blog): update post "${form.title}"` : `feat(blog): publish post "${form.title}"`

        const allLocalImages: Array<{ img: Extract<ImageItem, { type: 'file' }>; id: string }> = []
        for (const img of images || []) {
            if (img.type === 'file') allLocalImages.push({ img, id: img.id })
        }
        if (cover?.type === 'file') allLocalImages.push({ img: cover, id: cover.id })

        toast.loading('正在准备文件...', { id: toastId })

        const uploadedHashes = new Set<string>()
        let mdToUpload = form.md
        let coverPath: string | undefined
        const treeItems: TreeItem[] = []

        // 3. 处理图片上传
        if (allLocalImages.length > 0) {
            toast.loading(`📤 准备上传 ${allLocalImages.length} 张图片...`, { id: toastId })
            let idx = 1
            for (const { img, id } of allLocalImages) {
                toast.loading(`📸 正在上传图片 (${idx++}/${allLocalImages.length})...`, { id: toastId })
                const hash = img.hash || (await hashFileSHA256(img.file))
                const ext = getFileExt(img.file.name)
                const filename = `${hash}${ext}`
                const publicPath = `/images/${form.slug}/${filename}`

                if (!uploadedHashes.has(hash)) {
                    const path = `public/images/${form.slug}/${filename}`
                    const contentBase64 = await fileToBase64NoPrefix(img.file)
                    const blobData = await createBlob(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, contentBase64, 'base64')
                    
                    if (!blobData.sha) throw new Error(`图片上传失败: ${filename}`) // 安全检查
                    
                    treeItems.push({
                        path,
                        mode: '100644',
                        type: 'blob',
                        sha: blobData.sha
                    })
                    uploadedHashes.add(hash)
                }

                const placeholder = `local-image:${id}`
                mdToUpload = mdToUpload.split(`(${placeholder})`).join(`(${publicPath})`)

                if (cover?.type === 'file' && cover.id === id) {
                    coverPath = publicPath
                }
            }
        }

        if (cover?.type === 'url') coverPath = cover.url

        // 4. 创建 Markdown 文件 Blob
        toast.loading('正在创建文章内容...', { id: toastId })
        const dateStr = form.date || formatDateTimeLocal()
        const frontmatter = {
            title: form.title,
            description: form.summary,
            pubDate: dateStr,
            image: coverPath,
            draft: form.hidden,
            tags: form.tags,
            categories: form.categories
        }
        const finalContent = stringifyFrontmatter(frontmatter, mdToUpload)

        toast.loading('📝 正在生成文章内容...', { id: toastId })
        const mdBlob = await createBlob(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, toBase64Utf8(finalContent), 'base64')
        
        treeItems.push({
            path: `src/content/blog/${form.slug}.md`,
            mode: '100644',
            type: 'blob',
            sha: mdBlob.sha
        })

        // 5. 【关键步骤】创建新 Tree
        // 这里的 base_tree 必须是 latestTreeSha，绝对不能是 latestCommitSha
        toast.loading('🌳 正在构建文件树...', { id: toastId })
        console.log('🌳 Creating tree with base:', latestTreeSha)
        console.log('📂 Tree items:', treeItems)
        
        const treeData = await createTree(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, treeItems, latestTreeSha)

        // 6. 创建 Commit
        // 这里 parents 数组里放的是 latestCommitSha (父提交)，这是对的
        toast.loading('💾 正在提交更改...', { id: toastId })
        const commitDataNew = await createCommit(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, commitMessage, treeData.sha, [latestCommitSha])

        // 7. 更新引用 (Push)
        toast.loading('🔄 正在同步远程分支...', { id: toastId })
        await updateRef(token, GITHUB_CONFIG.OWNER, GITHUB_CONFIG.REPO, `heads/${GITHUB_CONFIG.BRANCH}`, commitDataNew.sha)

        toast.success(`🎉 ${mode === 'edit' ? '更新' : '发布'}成功！`, { 
            id: toastId,
            duration: 5000,
            description: 'GitHub Actions 将会自动部署您的站点，请稍候。'
        })
    } catch (error: any) {
        console.error('❌ Push Blog Failed:', error)
        toast.error('❌ 操作失败', { 
            id: toastId,
            description: error.message || '发生了未知错误，请重试'
        })
        throw error
    }
}