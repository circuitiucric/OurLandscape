-- Schema-only export from the live MySQL database.

-- Contains database objects only; no application rows or credentials.

CREATE DATABASE IF NOT EXISTS `pdf_website` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

USE `pdf_website`;

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `annotations` (
  `annotation_id` int NOT NULL AUTO_INCREMENT,
  `pdf_file` varchar(255) DEFAULT NULL,
  `page_number` int DEFAULT NULL,
  `text` text NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `user_name` varchar(255) DEFAULT NULL,
  `reply_id` int DEFAULT NULL,
  `position_y` decimal(10,2) DEFAULT NULL,
  `y2_position` int DEFAULT NULL,
  `x1_position` int DEFAULT NULL,
  `x2_position` int DEFAULT NULL,
  `selected_text` text,
  `text_start_offset` int DEFAULT NULL,
  `text_end_offset` int DEFAULT NULL,
  `visibility_level` tinyint NOT NULL DEFAULT '2',
  `video_time` float DEFAULT NULL,
  `video_file` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`annotation_id`),
  KEY `FK_reply_id` (`reply_id`),
  CONSTRAINT `FK_reply_id` FOREIGN KEY (`reply_id`) REFERENCES `replies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `follow_group_members` (
  `group_id` int NOT NULL,
  `target_user` varchar(255) NOT NULL,
  PRIMARY KEY (`group_id`,`target_user`),
  CONSTRAINT `follow_group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `follow_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `follow_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `owner_user` varchar(255) NOT NULL,
  `name` varchar(120) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_default` tinyint NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_owner` (`owner_user`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `follows` (
  `id` int NOT NULL AUTO_INCREMENT,
  `follower` varchar(255) NOT NULL,
  `target_user` varchar(255) NOT NULL,
  `level` tinyint NOT NULL DEFAULT '2',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_follow` (`follower`,`target_user`),
  KEY `idx_follower` (`follower`),
  KEY `idx_target` (`target_user`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `images` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reply_id` int NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `upload_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `reply_id` (`reply_id`),
  CONSTRAINT `images_ibfk_1` FOREIGN KEY (`reply_id`) REFERENCES `replies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `noteboard_clips` (
  `id` int NOT NULL AUTO_INCREMENT,
  `noteboard_id` int NOT NULL,
  `source_board_id` int DEFAULT NULL,
  `source_user` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `noteboard_id` (`noteboard_id`),
  CONSTRAINT `noteboard_clips_ibfk_1` FOREIGN KEY (`noteboard_id`) REFERENCES `noteboards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `noteboard_connections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `noteboard_id` int NOT NULL,
  `from_item_id` int NOT NULL,
  `to_item_id` int NOT NULL,
  `line_type` enum('straight','curved') NOT NULL DEFAULT 'straight',
  `label` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ctrl_x` float DEFAULT NULL,
  `ctrl_y` float DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `noteboard_id` (`noteboard_id`),
  KEY `from_item_id` (`from_item_id`),
  KEY `to_item_id` (`to_item_id`),
  CONSTRAINT `noteboard_connections_ibfk_1` FOREIGN KEY (`noteboard_id`) REFERENCES `noteboards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `noteboard_connections_ibfk_2` FOREIGN KEY (`from_item_id`) REFERENCES `noteboard_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `noteboard_connections_ibfk_3` FOREIGN KEY (`to_item_id`) REFERENCES `noteboard_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `noteboard_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `noteboard_id` int NOT NULL,
  `item_type` enum('pdf','thread','annotation','video','webpage','text_note') NOT NULL,
  `resource_id` int DEFAULT NULL,
  `text_content` text,
  `title` varchar(500) DEFAULT NULL,
  `status` enum('pending','deployed') NOT NULL DEFAULT 'pending',
  `group_index` int NOT NULL DEFAULT '0',
  `col` int NOT NULL DEFAULT '0',
  `row_index` int NOT NULL DEFAULT '0',
  `w` int NOT NULL DEFAULT '5',
  `h` int NOT NULL DEFAULT '3',
  `reading_progress` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `note_text` text,
  `clip_id` int DEFAULT NULL,
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `clip_dx` int NOT NULL DEFAULT '0',
  `clip_dy` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `noteboard_id` (`noteboard_id`),
  CONSTRAINT `noteboard_items_ibfk_1` FOREIGN KEY (`noteboard_id`) REFERENCES `noteboards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `noteboards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_name` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL DEFAULT '未命名笔记板',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_public` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `owner_featured_floors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `root_thread_id` int NOT NULL,
  `reply_id` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_root_reply` (`root_thread_id`,`reply_id`),
  KEY `idx_root` (`root_thread_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reading_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_name` varchar(255) NOT NULL,
  `resource_id` int NOT NULL,
  `page_number` int DEFAULT '1',
  `progress_percent` float DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `classified_page` int DEFAULT NULL,
  `classified_progress` float DEFAULT NULL,
  `classified_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_resource` (`user_name`,`resource_id`),
  KEY `resource_id` (`resource_id`),
  CONSTRAINT `reading_history_ibfk_1` FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource_id` int NOT NULL,
  `user_name` varchar(255) NOT NULL,
  `primary_tag` varchar(100) NOT NULL,
  `custom_name` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `evaluation` text,
  PRIMARY KEY (`id`),
  KEY `resource_id` (`resource_id`),
  CONSTRAINT `recommendations_ibfk_1` FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `replies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `thread_id` int DEFAULT NULL,
  `content` json DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `source_selection` text,
  `root_thread_id` int DEFAULT NULL,
  `visibility_level` tinyint NOT NULL DEFAULT '2',
  PRIMARY KEY (`id`),
  KEY `thread_id` (`thread_id`),
  KEY `idx_replies_root_thread_id` (`root_thread_id`),
  CONSTRAINT `replies_ibfk_1` FOREIGN KEY (`thread_id`) REFERENCES `threads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resource_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource_id` int NOT NULL,
  `tag` varchar(100) NOT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `vote_score` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `resource_id` (`resource_id`),
  CONSTRAINT `resource_tags_ibfk_1` FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `type` enum('pdf','video','post','notebook','external_link') NOT NULL,
  `identifier` varchar(500) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `cover_path` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_type_identifier` (`type`,`identifier`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `threads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `annotation_id` int DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `root_thread_id` int DEFAULT NULL,
  `title` varchar(500) DEFAULT NULL,
  `post_type` varchar(20) DEFAULT 'annotation',
  `visibility_level` tinyint NOT NULL DEFAULT '2',
  PRIMARY KEY (`id`),
  KEY `annotation_id` (`annotation_id`),
  KEY `idx_threads_root_thread_id` (`root_thread_id`),
  CONSTRAINT `threads_ibfk_1` FOREIGN KEY (`annotation_id`) REFERENCES `annotations` (`annotation_id`),
  CONSTRAINT `threads_ibfk_2` FOREIGN KEY (`annotation_id`) REFERENCES `annotations` (`annotation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userName` varchar(255) NOT NULL,
  `passWord` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `annotation_color` varchar(7) DEFAULT '#FFA500',
  `bio` text,
  `region` varchar(120) DEFAULT NULL,
  `preferences` varchar(500) DEFAULT NULL,
  `avatar_path` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `userName` (`userName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

